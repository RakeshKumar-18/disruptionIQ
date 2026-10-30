// What happens when a carrier event arrives: dedupe, reject stale or conflicting updates,
// apply it to the shipment, then detect the disruption and its at-risk orders.
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { ApiError, isUniqueViolation } from "../http";
import { audit, inr, nextId, notify } from "../records";
import { computeImpact, type AffectedShipment } from "./impact";

type Effect = "delay" | "quarantine" | "shutdown" | "status" | "delivered";

export const EVENT_TYPES: Record<string, { label: string; status: string; effect: Effect }> = {
  SHIPMENT_DELAYED: { label: "Supplier shipment delay", status: "Delayed", effect: "delay" },
  ROUTE_CHANGED: { label: "Carrier route disruption", status: "Rerouted", effect: "delay" },
  CUSTOMS_HOLD: { label: "Customs clearance hold", status: "Customs Hold", effect: "delay" },
  QUALITY_HOLD: { label: "Quality inspection hold", status: "Quality Hold", effect: "delay" },
  WEATHER_DELAY: { label: "Weather-related transport delay", status: "Weather Hold", effect: "delay" },
  PORT_CONGESTION: { label: "Port congestion", status: "Port Congestion", effect: "delay" },
  SUPPLIER_SHUTDOWN: { label: "Supplier production shutdown", status: "Supplier Shutdown", effect: "shutdown" },
  COLD_CHAIN_ALERT: { label: "Cold-chain temperature excursion", status: "Quarantined", effect: "quarantine" },
  IN_TRANSIT: { label: "In-transit update", status: "In Transit", effect: "status" },
  DELIVERED: { label: "Delivered", status: "Delivered", effect: "delivered" },
};

export type EventInput = {
  event_id: string;
  idempotency_key: string;
  event_type: string;
  shipment_id: string;
  event_timestamp: string;
  location?: string;
  delay_days: number;
};

export type EventResult = {
  outcome: "APPLIED" | "DUPLICATE" | "STALE" | "CONFLICT";
  message: string;
  disruptionId?: string;
  ordersAtRisk?: number;
};

const dateText = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "no date");

async function duplicate(ev: EventInput, actor: string): Promise<EventResult> {
  await db.$transaction(async (tx) => {
    await audit(tx, actor, "EVENT_DUPLICATE", ev.shipment_id, `Ignored ${ev.event_id}: idempotency key ${ev.idempotency_key} was already processed.`);
  });
  return { outcome: "DUPLICATE", message: `Duplicate ignored safely: ${ev.idempotency_key} was already processed.` };
}

export async function processEvent(ev: EventInput, actor: string, now = new Date()): Promise<EventResult> {
  const info = EVENT_TYPES[ev.event_type];
  if (!info) throw new ApiError(400, `Unknown event_type ${ev.event_type}.`);
  if (await db.carrierEvent.findUnique({ where: { idempotencyKey: ev.idempotency_key } })) return duplicate(ev, actor);

  try {
    return await db.$transaction((tx) => applyEvent(tx, ev, info, actor, now), { timeout: 60_000, maxWait: 15_000 });
  } catch (e) {
    // Two copies arriving at the same moment: the unique key lets exactly one through.
    if (isUniqueViolation(e)) return duplicate(ev, actor);
    throw e;
  }
}

async function applyEvent(
  tx: Tx,
  ev: EventInput,
  info: (typeof EVENT_TYPES)[string],
  actor: string,
  now: Date,
): Promise<EventResult> {
  const shipment = await tx.shipment.findUnique({
    where: { id: ev.shipment_id },
    include: { items: true, supplier: true, warehouse: true },
  });
  if (!shipment) throw new ApiError(404, `Unknown shipment ${ev.shipment_id}.`);
  const occurredAt = new Date(ev.event_timestamp);

  const record = (outcome: string) =>
    tx.carrierEvent.create({
      data: {
        idempotencyKey: ev.idempotency_key, eventId: ev.event_id, type: ev.event_type, shipmentId: shipment.id,
        location: ev.location ?? null, delayDays: ev.delay_days, occurredAt, outcome, payload: ev as unknown as Prisma.InputJsonValue,
      },
    });

  // Out-of-order update: older than what we already applied.
  if (shipment.lastEventAt && occurredAt < shipment.lastEventAt) {
    await record("Ignored: older than the last update applied (stale)");
    await audit(tx, actor, "EVENT_STALE", shipment.id, `Ignored ${ev.event_id} (${ev.event_type}): it happened before the last applied update.`);
    await notify(tx, { role: "Administrator" }, `Stale event ${ev.event_id} for ${shipment.id} ignored.`, "warning");
    return { outcome: "STALE", message: `Stale event ignored: ${shipment.id} already has a newer update.` };
  }
  // Conflicting update: the shipment has already arrived.
  if (shipment.status === "Delivered") {
    await record("Ignored: shipment already delivered (conflicting update)");
    await audit(tx, actor, "EVENT_CONFLICT", shipment.id, `Ignored ${ev.event_id} (${ev.event_type}): shipment was already delivered.`);
    await notify(tx, { role: "Administrator" }, `Conflicting event ${ev.event_id} ignored: ${shipment.id} was already delivered.`, "warning");
    return { outcome: "CONFLICT", message: `Conflicting event ignored: ${shipment.id} was already delivered.` };
  }

  // Plain status updates: no disruption.
  if (info.effect === "status" || (info.effect === "delay" && ev.delay_days <= 0)) {
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: info.status, lastEventAt: occurredAt } });
    await record("Applied: status update");
    await audit(tx, actor, "EVENT_APPLIED", shipment.id, `${ev.event_id}: ${info.label}, no delay.`);
    return { outcome: "APPLIED", message: `${shipment.id} updated: ${info.status}, no delay, no orders affected.` };
  }
  if (info.effect === "delivered") {
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: "Delivered", actualArrivalAt: occurredAt, lastEventAt: occurredAt } });
    for (const it of shipment.items) {
      const inv = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: shipment.warehouseId, productId: it.productId } } });
      if (inv) {
        await tx.inventory.update({
          where: { id: inv.id },
          data: { onHand: inv.onHand + it.quantity, inbound: Math.max(0, inv.inbound - it.quantity), updatedAt: now },
        });
      }
    }
    await record("Applied: delivered, stock received");
    await audit(tx, actor, "EVENT_APPLIED", shipment.id, `${ev.event_id}: delivered to ${shipment.warehouse.name}; stock received.`);
    return { outcome: "APPLIED", message: `${shipment.id} delivered; stock added to ${shipment.warehouse.name}.` };
  }

  // Disruptive events.
  let affected: AffectedShipment[];
  let title: string;
  let description: string;
  const supplier = shipment.supplier;
  const where = ev.location ? ` at ${ev.location}` : "";

  if (info.effect === "delay") {
    const newEta = shipment.expectedArrivalAt ? new Date(shipment.expectedArrivalAt.getTime() + ev.delay_days * 86_400_000) : null;
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { expectedArrivalAt: newEta, delayDays: shipment.delayDays + ev.delay_days, status: info.status, lastEventAt: occurredAt },
    });
    affected = [{ id: shipment.id, warehouseId: shipment.warehouseId, newEta, reliabilityPct: supplier.reliabilityPct, leadTimeDays: supplier.leadTimeDays, items: shipment.items }];
    title = `${info.label}${where}: ${shipment.id} +${ev.delay_days} days`;
    description = `${shipment.carrier} reports shipment ${shipment.id} from ${supplier.name} to ${shipment.warehouse.name} is ${ev.delay_days} more days late. New arrival: ${dateText(newEta)}.`;
  } else if (info.effect === "quarantine") {
    await tx.shipment.update({ where: { id: shipment.id }, data: { expectedArrivalAt: null, status: info.status, lastEventAt: occurredAt } });
    affected = [{ id: shipment.id, warehouseId: shipment.warehouseId, newEta: null, reliabilityPct: supplier.reliabilityPct, leadTimeDays: supplier.leadTimeDays, items: shipment.items }];
    title = `${info.label}${where}: ${shipment.id} quarantined`;
    description = `The cold chain on shipment ${shipment.id} (${supplier.name} to ${shipment.warehouse.name}) broke. The batch is quarantined and can't be used, so there is no usable arrival date.`;
  } else {
    // Supplier shutdown: every undelivered shipment from this supplier loses its arrival date.
    const open = await tx.shipment.findMany({ where: { supplierId: supplier.id, status: { not: "Delivered" } }, include: { items: true } });
    await tx.supplier.update({ where: { id: supplier.id }, data: { active: false } });
    await tx.shipment.updateMany({ where: { id: { in: open.map((s) => s.id) } }, data: { expectedArrivalAt: null, status: info.status } });
    await tx.shipment.update({ where: { id: shipment.id }, data: { lastEventAt: occurredAt } });
    affected = open.map((s) => ({ id: s.id, warehouseId: s.warehouseId, newEta: null, reliabilityPct: supplier.reliabilityPct, leadTimeDays: supplier.leadTimeDays, items: s.items }));
    title = `${info.label}: ${supplier.name}`;
    description = `${supplier.name} (${supplier.city}) has stopped production. Its ${open.length} undelivered shipments have no arrival date.`;
  }

  const impacts = await computeImpact(tx, affected, now);
  const exposure = impacts.reduce((n, r) => n + r.exposureInr, 0);
  const severity =
    impacts.length === 0 ? "Low"
      : impacts.some((r) => r.riskLevel === "Critical") || exposure >= 500_000 ? "Critical"
        : impacts.length >= 5 || impacts.some((r) => r.riskLevel === "High") ? "High"
          : "Medium";
  const id = await nextId(tx, "disruption", "DIS");
  await tx.disruption.create({
    data: {
      id, type: ev.event_type, title,
      description: `${description} ${impacts.length} order${impacts.length === 1 ? "" : "s"} at risk, ${inr(exposure)} penalty exposure.`,
      severity, status: impacts.length ? "Active" : "Monitoring", shipmentId: shipment.id, supplierId: supplier.id,
      warehouseId: shipment.warehouseId, location: ev.location ?? null, delayDays: ev.delay_days, eventKey: ev.idempotency_key,
      createdAt: now,
    },
  });
  if (impacts.length) {
    await tx.disruptionOrder.createMany({
      data: impacts.map((r) => ({
        disruptionId: id, orderId: r.orderId, lines: r.lines, unitsShort: r.unitsShort, daysLate: r.daysLate,
        exposureInr: r.exposureInr, riskScore: r.riskScore, riskLevel: r.riskLevel, factors: r.factors, status: "At risk",
      })),
    });
  }
  await record(`Applied: created ${id}`);
  await audit(tx, actor, "DISRUPTION_DETECTED", id, `${ev.event_id} (${ev.event_type}) → ${impacts.length} orders at risk, ${inr(exposure)} exposure.`);
  if (impacts.length) {
    await notify(tx, { role: "Operations Analyst" }, `New disruption ${id}: ${impacts.length} orders at risk (${title}).`, severity === "Critical" ? "critical" : "warning");
  }
  return {
    outcome: "APPLIED",
    disruptionId: id,
    ordersAtRisk: impacts.length,
    message: `${id} created: ${impacts.length} orders at risk, ${inr(exposure)} exposure.`,
  };
}
