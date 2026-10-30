// Impact analysis: which open orders a late (or lost) inbound shipment puts at risk.
//
// Rule, per warehouse + product on the affected shipment(s):
//  1. Free stock (on hand minus reserved) covers the earliest-due orders first.
//  2. Orders not covered by free stock were relying on the inbound shipment, in deadline order,
//     up to the quantity on that shipment.
//  3. Such an order is AT RISK if the shipment now arrives after its deadline, or has no arrival date.
import type { Tx } from "../db";
import { DAY_MS, daysBetween } from "../records";
import { scoreRisk, type Factor } from "./risk";

export type AffectedShipment = {
  id: string;
  warehouseId: string;
  newEta: Date | null; // null = no usable arrival date
  reliabilityPct: number;
  leadTimeDays: number;
  items: { productId: string; quantity: number }[];
};

export type ImpactLine = { productId: string; productName: string; needed: number; short: number; unitPrice: number };

export type ImpactRow = {
  orderId: string;
  lines: ImpactLine[];
  unitsShort: number;
  unitsNeeded: number;
  daysLate: number;
  exposureInr: number;
  riskScore: number;
  riskLevel: string;
  factors: Factor[];
};

const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };

export async function computeImpact(tx: Tx, shipments: AffectedShipment[], now: Date): Promise<ImpactRow[]> {
  type Group = { warehouseId: string; productId: string; inbound: number; eta: Date | null; reliability: number; lead: number };
  const groups = new Map<string, Group>();
  for (const s of shipments) {
    for (const it of s.items) {
      const key = `${s.warehouseId}|${it.productId}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { warehouseId: s.warehouseId, productId: it.productId, inbound: it.quantity, eta: s.newEta, reliability: s.reliabilityPct, lead: s.leadTimeDays });
      } else {
        g.inbound += it.quantity;
        g.eta = g.eta && s.newEta ? (g.eta > s.newEta ? g.eta : s.newEta) : null;
        g.reliability = Math.min(g.reliability, s.reliabilityPct);
        g.lead = Math.max(g.lead, s.leadTimeDays);
      }
    }
  }
  if (groups.size === 0) return [];

  const warehouseIds = [...new Set([...groups.values()].map((g) => g.warehouseId))];
  const productIds = [...new Set([...groups.values()].map((g) => g.productId))];
  const [stock, items, products] = await Promise.all([
    tx.inventory.findMany({ where: { warehouseId: { in: warehouseIds }, productId: { in: productIds } } }),
    tx.orderItem.findMany({
      where: { productId: { in: productIds }, order: { warehouseId: { in: warehouseIds }, deadline: { gte: now } } },
      include: { order: { include: { customer: true } } },
    }),
    tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  type Pending = {
    order: (typeof items)[number]["order"];
    lines: ImpactLine[];
    eta: Date | null;
    reliability: number;
    lead: number;
  };
  const byOrder = new Map<string, Pending>();

  for (const g of groups.values()) {
    const inv = stock.find((s) => s.warehouseId === g.warehouseId && s.productId === g.productId);
    let free = inv ? Math.max(0, inv.onHand - inv.reserved) : 0;
    let inbound = g.inbound;
    const lines = items
      .filter((it) => it.productId === g.productId && it.order.warehouseId === g.warehouseId)
      .sort(
        (a, b) =>
          a.order.deadline.getTime() - b.order.deadline.getTime() ||
          (PRIORITY_RANK[a.order.priority] ?? 9) - (PRIORITY_RANK[b.order.priority] ?? 9) ||
          a.orderId.localeCompare(b.orderId),
      );
    for (const line of lines) {
      const covered = Math.min(line.quantity, free);
      free -= covered;
      const uncovered = line.quantity - covered;
      if (uncovered === 0 || inbound === 0) continue;
      const short = Math.min(uncovered, inbound);
      inbound -= short;
      const late = g.eta === null || g.eta > line.order.deadline;
      if (!late) continue;
      const p = byOrder.get(line.orderId) ?? { order: line.order, lines: [], eta: g.eta, reliability: g.reliability, lead: g.lead };
      p.lines.push({ productId: g.productId, productName: productName.get(g.productId) ?? g.productId, needed: line.quantity, short, unitPrice: line.unitPrice });
      p.eta = p.eta && g.eta ? (p.eta > g.eta ? p.eta : g.eta) : null;
      p.reliability = Math.min(p.reliability, g.reliability);
      p.lead = Math.max(p.lead, g.lead);
      byOrder.set(line.orderId, p);
    }
  }

  const rows: ImpactRow[] = [];
  for (const [orderId, p] of byOrder) {
    const o = p.order;
    const unitsShort = p.lines.reduce((n, l) => n + l.short, 0);
    const unitsNeeded = p.lines.reduce((n, l) => n + l.needed, 0);
    // With no arrival date, assume replacement stock takes the supplier's average lead time.
    const daysLate = p.eta ? Math.max(1, daysBetween(o.deadline, p.eta)) : Math.max(1, p.lead);
    const lateValue = p.lines.reduce((n, l) => n + l.short * l.unitPrice, 0);
    const exposureInr = Math.round(lateValue * (o.customer.penaltyPctPerDay / 100) * daysLate);
    const daysToDeadline = Math.floor((o.deadline.getTime() - now.getTime()) / DAY_MS);
    const risk = scoreRisk({
      daysToDeadline, unitsShort, unitsNeeded, tier: o.customer.tier, priority: o.priority, exposureInr, reliabilityPct: p.reliability,
    });
    rows.push({ orderId, lines: p.lines, unitsShort, unitsNeeded, daysLate, exposureInr, riskScore: risk.score, riskLevel: risk.level, factors: risk.factors });
  }
  return rows.sort((a, b) => b.riskScore - a.riskScore || b.exposureInr - a.exposureInr);
}
