// The Administrator's simulator: sends events from the dataset through the same pipeline a real
// carrier webhook uses. It picks events that will visibly affect orders, so each demo shows something.
import type { InboundEvent, PrismaClient } from "@prisma/client";
import { computeImpact, type AffectedShipment } from "./engine/impact";
import { EVENT_TYPES, processEvent, type EventResult } from "./engine/events";

const DAY = 86_400_000;

async function dryRunImpact(db: PrismaClient, ev: InboundEvent, now: Date): Promise<number> {
  const info = EVENT_TYPES[ev.type];
  const s = await db.shipment.findUnique({ where: { id: ev.shipmentId }, include: { items: true, supplier: true } });
  if (!s || s.status === "Delivered") return -1;
  let affected: AffectedShipment[] = [];
  const base = { reliabilityPct: s.supplier.reliabilityPct, leadTimeDays: s.supplier.leadTimeDays };
  if (info.effect === "delay") {
    if (ev.delayDays <= 0 || !s.expectedArrivalAt) return 0;
    affected = [{ id: s.id, warehouseId: s.warehouseId, newEta: new Date(s.expectedArrivalAt.getTime() + ev.delayDays * DAY), items: s.items, ...base }];
  } else if (info.effect === "quarantine") {
    affected = [{ id: s.id, warehouseId: s.warehouseId, newEta: null, items: s.items, ...base }];
  } else if (info.effect === "shutdown") {
    const open = await db.shipment.findMany({ where: { supplierId: s.supplierId, status: { not: "Delivered" } }, include: { items: true } });
    affected = open.map((o) => ({ id: o.id, warehouseId: o.warehouseId, newEta: null, items: o.items, ...base }));
  } else {
    return 0;
  }
  return (await computeImpact(db, affected, now)).length;
}

// Picks an unsent dataset event of this type. For disruptive types, prefers one that puts
// 3-25 orders at risk, so the demo is clear without flooding the screen.
export async function pickEvent(db: PrismaClient, type: string): Promise<InboundEvent | null> {
  const info = EVENT_TYPES[type];
  if (!info) return null;
  const candidates = await db.inboundEvent.findMany({
    where: { type, sentAt: null, ...(info.effect === "delay" ? { delayDays: { gte: 3 } } : {}) },
    orderBy: [{ delayDays: "desc" }, { eventId: "asc" }],
    take: 80,
  });
  if (info.effect === "status" || info.effect === "delivered") {
    for (const c of candidates) {
      const s = await db.shipment.findUnique({ where: { id: c.shipmentId } });
      if (s && s.status !== "Delivered") return c;
    }
    return null;
  }
  const now = new Date();
  let best: { ev: InboundEvent; n: number } | null = null;
  for (const c of candidates) {
    const n = await dryRunImpact(db, c, now);
    if (n >= 3 && n <= 25) return c;
    if (n > 0 && (!best || Math.abs(n - 10) < Math.abs(best.n - 10))) best = { ev: c, n };
  }
  return best?.ev ?? null;
}

// Sends a dataset event as if the carrier delivered it right now.
export async function sendInbound(db: PrismaClient, ev: InboundEvent, actor: string, opts: { duplicateOf?: boolean } = {}): Promise<EventResult> {
  const result = await processEvent(
    {
      event_id: opts.duplicateOf ? `${ev.eventId}-RESENT` : ev.eventId,
      idempotency_key: ev.idempotencyKey,
      event_type: ev.type,
      shipment_id: ev.shipmentId,
      event_timestamp: new Date().toISOString(),
      location: ev.location,
      delay_days: ev.delayDays,
    },
    actor,
  );
  if (!opts.duplicateOf) await db.inboundEvent.update({ where: { eventId: ev.eventId }, data: { sentAt: new Date() } });
  return result;
}

export const SCENARIO_TYPES = Object.entries(EVENT_TYPES)
  .filter(([, v]) => v.effect !== "status" && v.effect !== "delivered")
  .map(([type, v]) => ({ type, label: v.label }));
