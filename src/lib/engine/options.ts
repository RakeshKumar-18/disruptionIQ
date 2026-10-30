// Recovery options for one at-risk order, built from real stock, supplier history and deadlines.
// Every option is either feasible, or shown as not possible with the reason.
// Cost rules (stated so anyone can check them):
//  - Transfer: ₹2,000 per transfer + 1% of goods value per day in transit
//  - Split order: ₹1,500 for the extra delivery
//  - Expedite: ₹5,000 + 2% of the delayed goods value
//  - Alternative supplier: 15% price premium on the goods bought
import type { Tx } from "../db";
import { ApiError } from "../http";
import { DAY_MS } from "../records";
import { APPROVER_FOR, type PlanKind, type RoleName } from "../roles";
import type { ImpactLine } from "./impact";

export type RecoveryOption = {
  kind: PlanKind;
  approverRole: RoleName;
  feasible: boolean;
  reason?: string;
  summary: string;
  details: Record<string, unknown>;
  costInr: number;
  readyBy: string | null;
  saves: "Fully" | "Partly";
};

const DELAY_TYPES = ["SHIPMENT_DELAYED", "ROUTE_CHANGED", "CUSTOMS_HOLD", "QUALITY_HOLD", "WEATHER_DELAY", "PORT_CONGESTION"];
const dateText = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export async function buildOptions(tx: Tx, disruptionId: string, orderId: string, now = new Date()): Promise<RecoveryOption[]> {
  const link = await tx.disruptionOrder.findUnique({
    where: { disruptionId_orderId: { disruptionId, orderId } },
    include: { order: { include: { warehouse: true } }, disruption: { include: { shipment: true } } },
  });
  if (!link) throw new ApiError(404, "This order is not affected by that disruption.");
  const lines = (link.lines as ImpactLine[]).filter((l) => l.short > 0);
  const order = link.order;
  const dest = order.warehouse;
  const deadline = order.deadline;
  const daysLeft = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / DAY_MS));
  const productIds = lines.map((l) => l.productId);

  const [warehouses, stock, products, history] = await Promise.all([
    tx.warehouse.findMany(),
    tx.inventory.findMany({ where: { productId: { in: productIds }, warehouseId: { not: dest.id } } }),
    tx.product.findMany({ where: { id: { in: productIds } } }),
    tx.shipmentItem.findMany({ where: { productId: { in: productIds } }, select: { productId: true, shipment: { select: { supplier: true } } } }),
  ]);
  const wh = new Map(warehouses.map((w) => [w.id, w]));
  const cost = new Map(products.map((p) => [p.id, p.unitCost]));
  const transferDays = (fromId: string) => {
    const from = wh.get(fromId)!;
    return from.city === dest.city ? 1 : from.region === dest.region ? 2 : 3;
  };
  const options: RecoveryOption[] = [];
  const opt = (o: Omit<RecoveryOption, "approverRole">) => options.push({ ...o, approverRole: APPROVER_FOR[o.kind] });

  // 1. Reallocate stock from another warehouse.
  {
    const transfers: Record<string, unknown>[] = [];
    let missing: string | null = null;
    let worst = 0;
    let total = 0;
    for (const l of lines) {
      const best = stock
        .filter((s) => s.productId === l.productId && wh.get(s.warehouseId)?.status === "Active" && s.onHand - s.reserved >= l.short)
        .sort((a, b) => transferDays(a.warehouseId) - transferDays(b.warehouseId) || b.onHand - b.reserved - (a.onHand - a.reserved))[0];
      if (!best) {
        missing = l.productName;
        break;
      }
      const days = transferDays(best.warehouseId);
      const from = wh.get(best.warehouseId)!;
      worst = Math.max(worst, days);
      total += 2000 + l.short * (cost.get(l.productId) ?? l.unitPrice) * 0.01 * days;
      transfers.push({ productId: l.productId, productName: l.productName, units: l.short, fromWarehouseId: from.id, fromWarehouseName: from.name, fromCity: from.city, freeAtSource: best.onHand - best.reserved, transferDays: days });
    }
    const arrives = new Date(now.getTime() + worst * DAY_MS);
    if (missing) {
      opt({ kind: "Reallocate stock", feasible: false, reason: `No other warehouse has enough free ${missing}.`, summary: "Move stock from another warehouse", details: {}, costInr: 0, readyBy: null, saves: "Fully" });
    } else if (arrives > deadline) {
      opt({ kind: "Reallocate stock", feasible: false, reason: `The transfer takes ${worst} day${worst === 1 ? "" : "s"}, which arrives after the ${dateText(deadline)} deadline.`, summary: "Move stock from another warehouse", details: { transfers }, costInr: Math.round(total), readyBy: arrives.toISOString(), saves: "Fully" });
    } else {
      const t0 = transfers[0] as { units: number; fromWarehouseName: string };
      opt({
        kind: "Reallocate stock", feasible: true,
        summary: transfers.length === 1 ? `Move ${t0.units} units from ${t0.fromWarehouseName} to ${dest.name}` : `Move stock for ${transfers.length} products from other warehouses to ${dest.name}`,
        details: { transfers, toWarehouseId: dest.id, toWarehouseName: dest.name }, costInr: Math.round(total), readyBy: arrives.toISOString(), saves: "Fully",
      });
    }
  }

  // 2. Split the order: ship what is free in stock right now, the rest follows.
  {
    const here = await tx.inventory.findMany({ where: { warehouseId: dest.id, productId: { in: productIds } } });
    const freeHere = new Map(here.map((s) => [s.productId, Math.max(0, s.onHand - s.reserved)]));
    const shipNow = lines
      .map((l) => ({ productId: l.productId, productName: l.productName, units: Math.min(l.needed - l.short, freeHere.get(l.productId) ?? 0) }))
      .filter((x) => x.units > 0);
    const later = lines.map((l) => ({ productId: l.productId, productName: l.productName, units: l.needed - (shipNow.find((s) => s.productId === l.productId)?.units ?? 0) }));
    const nowUnits = shipNow.reduce((n, x) => n + x.units, 0);
    const laterUnits = later.reduce((n, x) => n + x.units, 0);
    if (nowUnits === 0) {
      opt({ kind: "Split order", feasible: false, reason: `${dest.name} has no free stock of the affected products right now, so there is nothing to ship early.`, summary: "Ship what is in stock now", details: {}, costInr: 0, readyBy: null, saves: "Partly" });
    } else {
      opt({
        kind: "Split order", feasible: true, summary: `Ship ${nowUnits} units on time now; ${laterUnits} follow when stock arrives`,
        details: { shipNow, later, warehouseId: dest.id }, costInr: 1500, readyBy: now.toISOString(), saves: "Partly",
      });
    }
  }

  // 3. Expedite the delayed shipment (only for delays with a known arrival date).
  {
    const s = link.disruption.shipment;
    const kind: PlanKind = "Expedite shipment";
    if (!s || !DELAY_TYPES.includes(link.disruption.type) || !s.expectedArrivalAt || s.status === "Delivered") {
      opt({ kind, feasible: false, reason: "There is no inbound shipment with an arrival date to speed up.", summary: "Pay for faster freight", details: {}, costInr: 0, readyBy: null, saves: "Fully" });
    } else {
      const recover = Math.max(1, Math.min(3, link.disruption.delayDays));
      const newEta = new Date(s.expectedArrivalAt.getTime() - recover * DAY_MS);
      const value = lines.reduce((n, l) => n + l.short * l.unitPrice, 0);
      const c = Math.round(5000 + value * 0.02);
      if (newEta > deadline) {
        opt({ kind, feasible: false, reason: `Even ${recover} days faster, ${s.id} arrives ${dateText(newEta)}, after the ${dateText(deadline)} deadline.`, summary: `Expedite ${s.id}`, details: { shipmentId: s.id, daysRecovered: recover }, costInr: c, readyBy: newEta.toISOString(), saves: "Fully" });
      } else {
        opt({ kind, feasible: true, summary: `Pay for priority freight on ${s.id}: arrives ${recover} day${recover === 1 ? "" : "s"} sooner (${dateText(newEta)})`, details: { shipmentId: s.id, daysRecovered: recover, newEta: newEta.toISOString() }, costInr: c, readyBy: newEta.toISOString(), saves: "Fully" });
      }
    }
  }

  // 4. Buy from an alternative supplier that has supplied this product before.
  {
    const kind: PlanKind = "Alternative supplier";
    const original = link.disruption.supplierId;
    const purchases: Record<string, unknown>[] = [];
    let missing: string | null = null;
    let lead = 0;
    let total = 0;
    for (const l of lines) {
      const candidates = new Map<string, (typeof history)[number]["shipment"]["supplier"]>();
      for (const h of history) {
        const sup = h.shipment.supplier;
        if (h.productId === l.productId && sup.id !== original && sup.active && sup.reliabilityPct >= 80 && sup.leadTimeDays <= daysLeft) candidates.set(sup.id, sup);
      }
      const best = [...candidates.values()].sort((a, b) => b.reliabilityPct - a.reliabilityPct || a.leadTimeDays - b.leadTimeDays)[0];
      if (!best) {
        missing = l.productName;
        break;
      }
      lead = Math.max(lead, best.leadTimeDays);
      total += l.short * (cost.get(l.productId) ?? l.unitPrice) * 0.15;
      purchases.push({ productId: l.productId, productName: l.productName, units: l.short, supplierId: best.id, supplierName: best.name, city: best.city, reliabilityPct: best.reliabilityPct, leadTimeDays: best.leadTimeDays });
    }
    if (missing) {
      opt({ kind, feasible: false, reason: `No reliable alternative supplier (80%+ on time) can deliver ${missing} within ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`, summary: "Buy from another supplier", details: {}, costInr: 0, readyBy: null, saves: "Fully" });
    } else {
      const p0 = purchases[0] as { supplierName: string; reliabilityPct: number };
      const arrives = new Date(now.getTime() + lead * DAY_MS);
      opt({
        kind, feasible: true,
        summary: purchases.length === 1 ? `Buy from ${p0.supplierName} (${p0.reliabilityPct}% on time), arriving ${dateText(arrives)}` : `Buy ${purchases.length} products from alternative suppliers, arriving ${dateText(arrives)}`,
        details: { purchases, warehouseId: dest.id }, costInr: Math.round(total), readyBy: arrives.toISOString(), saves: "Fully",
      });
    }
  }

  // Feasible first, cheapest first.
  return options.sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.costInr - b.costInr);
}
