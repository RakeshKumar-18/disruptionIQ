// Read models for the screens: what each role sees, already shaped for the UI.
import type { Plan, Prisma } from "@prisma/client";
import { db } from "./db";
import { recheck } from "./engine/execute";
import { EVENT_TYPES } from "./engine/events";
import { CITIES, stateOf } from "./geo";
import { inr, iso } from "./records";
import { can, reviewRolesFor } from "./roles";

const ACTIVE_PLAN = ["Pending approval", "Changes proposed", "Approved"];
const DELAYED_STATUSES = ["Delayed", "Customs Hold", "Weather Hold", "Quality Hold", "Port Congestion", "Rerouted", "Supplier Shutdown", "Quarantined"];

export async function badges(user: { id: string; role: string }) {
  const out: Record<string, number> = {};
  if (can(user.role, "view_network")) out.disruptions = await db.disruption.count({ where: { status: "Active" } });
  if (can(user.role, "submit")) {
    out.myPlans = await db.plan.count({ where: { createdById: user.id, status: { in: ["Changes proposed", "Blocked"] } } });
  }
  const review = reviewRolesFor(user.role);
  if (review.length) out.review = await db.plan.count({ where: { approverRole: { in: review }, status: "Pending approval", createdById: { not: user.id } } });
  if (can(user.role, "execute")) out.execute = await db.plan.count({ where: { status: "Approved" } });
  return out;
}

type Signal = { level: "Critical" | "High" | "Medium" | "Recovering" | "Normal"; reason: string };

// Risk signal per location, from the rules engine's results (stated so anyone can check it):
//  Critical: an order here scores Critical, or ₹10 lakh+ penalty exposure
//  High:     5+ orders at risk, ₹2 lakh+ exposure, or an order scoring High
//  Medium:   any order at risk
//  Recovering: no order at risk, but recoveries are approved or under way
//  Normal:   nothing at risk
function signalFor(l: { orders: { atRisk: number; approved: number; recovered: number }; units: { atRisk: number; approved: number }; exposureInr: number; worst: string | null }): Signal {
  const { orders, units, exposureInr: x, worst } = l;
  if (orders.atRisk > 0) {
    const reason = `${orders.atRisk} order${orders.atRisk === 1 ? "" : "s"} at risk (${units.atRisk.toLocaleString("en-IN")} units), ${inr(x)} penalty exposure`;
    if (worst === "Critical" || x >= 1_000_000) return { level: "Critical", reason };
    if (orders.atRisk >= 5 || x >= 200_000 || worst === "High") return { level: "High", reason };
    return { level: "Medium", reason };
  }
  if (orders.approved > 0 || orders.recovered > 0) {
    return { level: "Recovering", reason: `${orders.approved} approved recover${orders.approved === 1 ? "y" : "ies"} waiting to run, ${orders.recovered} order${orders.recovered === 1 ? "" : "s"} recovered` };
  }
  return { level: "Normal", reason: "No orders at risk" };
}

const LEVEL_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Recovering: 3, Normal: 4 };
const RISK_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export async function overview() {
  const [disruptions, links, warehouses, plans, stock, inbound, suppliers] = await Promise.all([
    db.disruption.findMany({ where: { status: { in: ["Active", "Resolved"] } }, orderBy: { createdAt: "desc" } }),
    db.disruptionOrder.findMany({
      where: { disruption: { status: { in: ["Active", "Resolved"] } } },
      select: { disruptionId: true, orderId: true, status: true, exposureInr: true, unitsShort: true, riskLevel: true, order: { select: { warehouseId: true } } },
    }),
    db.warehouse.findMany({ orderBy: { id: "asc" } }),
    db.plan.findMany({ where: { status: { in: ACTIVE_PLAN } }, select: { disruptionId: true, orderId: true, status: true } }),
    db.inventory.groupBy({ by: ["warehouseId"], _sum: { onHand: true, reserved: true } }),
    db.shipment.groupBy({ by: ["warehouseId", "status"], where: { status: { not: "Delivered" } }, _count: { _all: true } }),
    db.supplier.findMany({ select: { id: true, name: true, city: true, active: true } }),
  ]);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const whById = new Map(warehouses.map((w) => [w.id, w]));
  const planFor = new Map(plans.map((p) => [`${p.disruptionId}|${p.orderId}`, p.status]));

  // Where each affected order stands: at risk, approved (waiting to run) or recovered.
  const state = (l: (typeof links)[number]) =>
    l.status !== "At risk" ? "recovered" : planFor.get(`${l.disruptionId}|${l.orderId}`) === "Approved" ? "approved" : "atRisk";

  type Loc = {
    city: string; state: string;
    warehouses: { id: string; name: string; status: string; onHand: number; free: number }[];
    suppliers: number; suppliersDown: number;
    stock: { onHand: number; free: number };
    inbound: { open: number; delayed: number };
    orders: { atRisk: number; approved: number; recovered: number };
    units: { atRisk: number; approved: number; recovered: number };
    exposureInr: number; worst: string | null; disruptions: string[];
  };
  const locs = new Map<string, Loc>();
  const loc = (city: string): Loc => {
    let l = locs.get(city);
    if (!l) {
      l = {
        city, state: stateOf(city), warehouses: [], suppliers: 0, suppliersDown: 0, stock: { onHand: 0, free: 0 }, inbound: { open: 0, delayed: 0 },
        orders: { atRisk: 0, approved: 0, recovered: 0 }, units: { atRisk: 0, approved: 0, recovered: 0 }, exposureInr: 0, worst: null, disruptions: [],
      };
      locs.set(city, l);
    }
    return l;
  };
  for (const city of Object.keys(CITIES)) loc(city);
  for (const w of warehouses) {
    const s = stock.find((x) => x.warehouseId === w.id)?._sum;
    const onHand = s?.onHand ?? 0, free = onHand - (s?.reserved ?? 0);
    const l = loc(w.city);
    l.warehouses.push({ id: w.id, name: w.name, status: w.status, onHand, free });
    l.stock.onHand += onHand;
    l.stock.free += free;
  }
  for (const g of inbound) {
    const w = whById.get(g.warehouseId);
    if (!w) continue;
    const l = loc(w.city);
    l.inbound.open += g._count._all;
    if (DELAYED_STATUSES.includes(g.status)) l.inbound.delayed += g._count._all;
  }
  for (const s of suppliers) {
    const l = loc(s.city);
    l.suppliers++;
    if (!s.active) l.suppliersDown++;
  }
  for (const k of links) {
    const w = whById.get(k.order.warehouseId);
    if (!w) continue;
    const l = loc(w.city);
    const st = state(k);
    l.orders[st]++;
    l.units[st] += k.unitsShort;
    if (st === "atRisk") {
      l.exposureInr += k.exposureInr;
      if (!l.worst || (RISK_RANK[k.riskLevel] ?? 9) < (RISK_RANK[l.worst] ?? 9)) l.worst = k.riskLevel;
    }
    if (!l.disruptions.includes(k.disruptionId)) l.disruptions.push(k.disruptionId);
  }
  const locations = [...locs.values()]
    .map(({ worst, ...l }) => ({ ...l, signal: signalFor({ ...l, worst }) }))
    .sort((a, b) => LEVEL_RANK[a.signal.level] - LEVEL_RANK[b.signal.level] || b.exposureInr - a.exposureInr || a.city.localeCompare(b.city));

  const list = disruptions.map((d) => {
    const mine = links.filter((l) => l.disruptionId === d.id);
    const sup = d.supplierId ? supplierById.get(d.supplierId) : undefined;
    const wh = d.warehouseId ? whById.get(d.warehouseId) : undefined;
    const destinations = [...new Set(mine.map((l) => whById.get(l.order.warehouseId)?.city).filter(Boolean))] as string[];
    return {
      id: d.id, type: d.type, typeLabel: EVENT_TYPES[d.type]?.label ?? d.type, title: d.title, description: d.description,
      severity: d.severity, status: d.status, createdAt: iso(d.createdAt), location: d.location,
      supplier: sup ? { id: sup.id, name: sup.name, city: sup.city } : null,
      warehouse: wh ? { id: wh.id, name: wh.name, city: wh.city } : null,
      shipmentId: d.shipmentId,
      atRisk: mine.filter((l) => state(l) === "atRisk").length,
      approved: mine.filter((l) => state(l) === "approved").length,
      recovered: mine.filter((l) => state(l) === "recovered").length,
      exposureInr: mine.filter((l) => state(l) === "atRisk").reduce((n, l) => n + l.exposureInr, 0),
      destinationCities: destinations,
    };
  });

  const total = (k: "atRisk" | "approved" | "recovered") => locations.reduce((n, l) => n + l.orders[k], 0);
  return {
    kpis: {
      activeDisruptions: disruptions.filter((d) => d.status === "Active").length,
      ordersAtRisk: total("atRisk"),
      unitsAtRisk: locations.reduce((n, l) => n + l.units.atRisk, 0),
      exposureInr: locations.reduce((n, l) => n + l.exposureInr, 0),
      plansAwaitingApproval: plans.filter((p) => p.status === "Pending approval").length,
      ordersApproved: total("approved"),
      ordersRecovered: total("recovered"),
    },
    map: {
      summary: { cities: locations.length, states: new Set(locations.map((l) => l.state)).size, warehouses: warehouses.length, suppliers: suppliers.length },
      locations,
      routes: list
        .filter((d) => d.status === "Active" && d.supplier)
        .flatMap((d) => (d.destinationCities.length ? d.destinationCities : d.warehouse ? [d.warehouse.city] : []).map((to) => ({
          disruptionId: d.id, from: d.supplier!.city, to, severity: d.severity, label: d.typeLabel,
        }))),
    },
    disruptions: list,
  };
}

export async function disruptionDetail(id: string) {
  const d = await db.disruption.findUnique({
    where: { id },
    include: { shipment: { include: { supplier: true, warehouse: true } } },
  });
  if (!d) return null;
  const [impacts, plans] = await Promise.all([
    db.disruptionOrder.findMany({
      where: { disruptionId: id },
      include: { order: { include: { customer: true, warehouse: true } } },
      orderBy: [{ riskScore: "desc" }, { exposureInr: "desc" }],
    }),
    db.plan.findMany({ where: { disruptionId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const s = d.shipment;
  return {
    id: d.id, type: d.type, typeLabel: EVENT_TYPES[d.type]?.label ?? d.type, title: d.title, description: d.description,
    severity: d.severity, status: d.status, createdAt: iso(d.createdAt), location: d.location, delayDays: d.delayDays,
    shipment: s ? {
      id: s.id, carrier: s.carrier, status: s.status, eta: iso(s.expectedArrivalAt),
      supplier: { id: s.supplier.id, name: s.supplier.name, city: s.supplier.city, reliabilityPct: s.supplier.reliabilityPct },
      warehouse: { id: s.warehouse.id, name: s.warehouse.name, city: s.warehouse.city },
    } : null,
    orders: impacts.map((l) => {
      const plan = plans.find((p) => p.orderId === l.orderId && p.status !== "Withdrawn" && p.status !== "Rejected") ?? plans.find((p) => p.orderId === l.orderId);
      return {
        orderId: l.orderId, customerId: l.order.customerId, tier: l.order.customer.tier, priority: l.order.priority,
        deadline: iso(l.order.deadline), warehouse: l.order.warehouse.name, deliveryCity: l.order.deliveryCity,
        lines: l.lines, unitsShort: l.unitsShort, daysLate: l.daysLate, exposureInr: l.exposureInr,
        riskScore: l.riskScore, riskLevel: l.riskLevel, factors: l.factors, status: l.status,
        plan: plan ? { id: plan.id, kind: plan.kind, status: plan.status } : null,
        canPlan: l.status === "At risk" && !plans.some((p) => p.orderId === l.orderId && ACTIVE_PLAN.includes(p.status)),
      };
    }),
  };
}

type PlanWithRefs = Plan & {
  createdBy: { name: string };
  reviewedBy: { name: string } | null;
  executedBy: { name: string } | null;
  disruption: { id: string; title: string; severity: string };
  order: { id: string; priority: string; deadline: Date; deliveryCity: string; customer: { id: string; tier: string }; warehouse: { name: string } };
};

const planInclude = {
  createdBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  executedBy: { select: { name: true } },
  disruption: { select: { id: true, title: true, severity: true } },
  order: { select: { id: true, priority: true, deadline: true, deliveryCity: true, customer: { select: { id: true, tier: true } }, warehouse: { select: { name: true } } } },
} satisfies Prisma.PlanInclude;

async function planOut(p: PlanWithRefs, withCheck: boolean) {
  const link = await db.disruptionOrder.findUnique({ where: { disruptionId_orderId: { disruptionId: p.disruptionId, orderId: p.orderId } } });
  return {
    id: p.id, kind: p.kind, approverRole: p.approverRole, summary: p.summary, details: p.details, costInr: p.costInr, note: p.note,
    status: p.status, proposed: p.proposed,
    createdBy: p.createdBy.name, createdById: p.createdById, reviewedBy: p.reviewedBy?.name ?? null, executedBy: p.executedBy?.name ?? null,
    createdAt: iso(p.createdAt), reviewedAt: iso(p.reviewedAt), executedAt: iso(p.executedAt),
    disruption: p.disruption,
    order: {
      id: p.order.id, priority: p.order.priority, deadline: iso(p.order.deadline), deliveryCity: p.order.deliveryCity,
      customerId: p.order.customer.id, tier: p.order.customer.tier, warehouse: p.order.warehouse.name,
    },
    risk: link ? { score: link.riskScore, level: link.riskLevel, factors: link.factors, exposureInr: link.exposureInr, unitsShort: link.unitsShort, lines: link.lines, status: link.status } : null,
    liveCheck: withCheck ? (await recheck(db, p)) ?? "OK" : null,
  };
}

export async function plansFor(user: { id: string; role: string }, view: string) {
  let where: Prisma.PlanWhereInput;
  let withCheck = false;
  const review = reviewRolesFor(user.role);
  if (view === "mine" && can(user.role, "submit")) where = { createdById: user.id };
  else if (view === "review" && review.length) {
    // Plans you sent yourself never appear in your own approval queue.
    where = { approverRole: { in: review }, status: "Pending approval", createdById: { not: user.id } };
    withCheck = true;
  } else if (view === "reviewed" && review.length) where = { reviewedById: user.id };
  else if (view === "execute" && can(user.role, "execute")) {
    where = { status: "Approved" };
    withCheck = true;
  } else if (view === "executed" && can(user.role, "execute")) where = { executedById: user.id, status: "Executed" };
  else return null;
  const plans = (await db.plan.findMany({ where, orderBy: { createdAt: view === "review" || view === "execute" ? "asc" : "desc" }, include: planInclude, take: 100 })) as PlanWithRefs[];
  return Promise.all(plans.map((p) => planOut(p, withCheck)));
}
