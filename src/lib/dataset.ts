// Loads the synthetic dataset in data/*.csv into Postgres.
//
// Not imported, on purpose: disruptions.csv and disruption_order_impact.csv (the app detects
// disruptions and calculates impact itself, and those links don't match the shipment data),
// recovery_options.csv (the rules engine builds options from live stock), the 1-2 row sample
// files, and order_risk_training.csv (for the separate ML experiment).
//
// Dates: the dataset is written as if "now" were 2026-10-30 10:00. Every timestamp is shifted
// by (import time - that anchor), so deadlines and ETAs always look current on demo day.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { PrismaClient } from "@prisma/client";
import { hashPin } from "./pin";

export const DATA_DIR = join(process.cwd(), "data");
const ANCHOR = new Date("2026-10-30T10:00:00");

type Row = Record<string, string>;
const read = (file: string): Row[] =>
  parse(readFileSync(join(DATA_DIR, file), "utf8"), { columns: true, skip_empty_lines: true, bom: true, trim: true });

const ts = (s: string, shift: number) => (s ? new Date(new Date(s.replace(" ", "T")).getTime() + shift) : null);
const num = (s: string) => Number(s);
const bool = (s: string) => s.toLowerCase() === "true";

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// Demo accounts are named by role only.
export const DEMO_USERS = [
  { id: "u-analyst", name: "Operations Analyst", role: "Operations Analyst", pin: "1111" },
  { id: "u-manager", name: "Supply Chain Manager", role: "Supply Chain Manager", pin: "2222" },
  { id: "u-procurement", name: "Procurement Approver", role: "Procurement Approver", pin: "4444" },
  { id: "u-warehouse", name: "Warehouse Operator", role: "Warehouse Operator", pin: "3333" },
  { id: "u-admin", name: "Administrator", role: "Administrator", pin: "9999" },
];

// Customer tier rule: the top 20% of customers by total order value are Premium.
// Penalty if late: Premium 2% of the late goods' value per day, Standard 1% per day.
const PREMIUM_SHARE = 0.2;
const PENALTY = { Premium: 2, Standard: 1 };

// The two scenarios the demo starts with (the deck's live examples).
export const STARTING_SCENARIOS = ["PORT_CONGESTION", "SUPPLIER_SHUTDOWN"];

const CLEAR_ALL = `TRUNCATE "Session", "Plan", "DisruptionOrder", "Disruption", "CarrierEvent", "InboundEvent",
  "ShipmentItem", "Shipment", "OrderItem", "Order", "Customer", "Inventory", "Product", "Warehouse", "Supplier",
  "Notification", "AuditLog", "Counter", "Meta", "User" CASCADE`;
const CLEAR_ACTIVITY = `TRUNCATE "Plan", "DisruptionOrder", "Disruption", "CarrierEvent", "InboundEvent",
  "ShipmentItem", "Shipment", "Inventory", "Notification", "AuditLog", "Counter" CASCADE`;

// Inventory, shipments and carrier events: the parts the workflow changes.
async function loadActivityData(db: PrismaClient, shift: number, log: (s: string) => void) {
  const inv = read("inventory.csv");
  await inChunks(inv, 5000, (c) =>
    db.inventory.createMany({
      data: c.map((r) => ({ id: r.inventory_id, warehouseId: r.warehouse_id, productId: r.product_id, onHand: num(r.on_hand_qty), reserved: num(r.reserved_qty), inbound: num(r.inbound_qty), updatedAt: ts(r.last_updated_at, shift)! })),
    }),
  );
  log(`inventory: ${inv.length}`);

  const ships = read("shipments.csv");
  await inChunks(ships, 4000, (c) =>
    db.shipment.createMany({
      data: c.map((r) => ({
        id: r.shipment_id, supplierId: r.supplier_id, warehouseId: r.warehouse_id, carrier: r.carrier, trackingNumber: r.tracking_number,
        plannedDispatchAt: ts(r.planned_dispatch_at, shift)!, expectedArrivalAt: ts(r.expected_arrival_at, shift), actualArrivalAt: ts(r.actual_arrival_at, shift),
        status: r.current_status, delayDays: num(r.delay_days), lastEventAt: null,
      })),
    }),
  );
  const shipItems = read("shipment_items.csv");
  await inChunks(shipItems, 5000, (c) =>
    db.shipmentItem.createMany({ data: c.map((r) => ({ id: r.shipment_item_id, shipmentId: r.shipment_id, productId: r.product_id, quantity: num(r.shipped_qty) })) }),
  );
  log(`shipments: ${ships.length}, shipment items: ${shipItems.length}`);

  const events = read("carrier_webhook_events.csv");
  await db.inboundEvent.createMany({
    data: events.map((r) => ({ eventId: r.event_id, idempotencyKey: r.idempotency_key, type: r.event_type, shipmentId: r.shipment_id, location: r.location, delayDays: num(r.delay_days), occurredAt: ts(r.event_timestamp, shift)! })),
  });
  log(`carrier events waiting to be sent: ${events.length}`);

  await db.counter.createMany({ data: [{ name: "plan", value: 1000 }, { name: "disruption", value: 100 }, { name: "altShipment", value: 0 }] });
}

// Sends the starting scenarios through the same pipeline a carrier webhook uses.
async function startScenarios(db: PrismaClient, log: (s: string) => void) {
  const { pickEvent, sendInbound } = await import("./simulator");
  for (const type of STARTING_SCENARIOS) {
    const ev = await pickEvent(db, type);
    if (!ev) {
      log(`no suitable ${type} event found`);
      continue;
    }
    const r = await sendInbound(db, ev, "system (demo start)");
    log(`${type}: ${r.message}`);
  }
}

export async function importDataset(db: PrismaClient, log: (s: string) => void = console.log) {
  const shift = Date.now() - ANCHOR.getTime();
  await db.$executeRawUnsafe(CLEAR_ALL);

  await db.user.createMany({ data: DEMO_USERS.map(({ pin, ...u }) => ({ ...u, pinHash: hashPin(pin) })) });

  const suppliers = read("suppliers.csv");
  await db.supplier.createMany({
    data: suppliers.map((r) => ({ id: r.supplier_id, name: r.supplier_name, city: r.city, reliabilityPct: num(r.reliability_pct), leadTimeDays: num(r.average_lead_time_days), riskTier: r.risk_tier, active: bool(r.active) })),
  });
  const warehouses = read("warehouses.csv");
  await db.warehouse.createMany({
    data: warehouses.map((r) => ({ id: r.warehouse_id, name: r.warehouse_name, city: r.city, region: r.region, capacityUnits: num(r.capacity_units), status: r.operating_status })),
  });
  const products = read("products.csv");
  await db.product.createMany({
    data: products.map((r) => ({ id: r.product_id, name: r.product_name, category: r.category, unitCost: num(r.unit_cost), criticality: r.criticality, reorderLevel: num(r.reorder_level) })),
  });
  log(`suppliers: ${suppliers.length}, warehouses: ${warehouses.length}, products: ${products.length}`);

  const orders = read("orders.csv");
  const items = read("order_items.csv");
  const orderValue = new Map<string, number>();
  for (const it of items) orderValue.set(it.order_id, (orderValue.get(it.order_id) ?? 0) + num(it.quantity) * num(it.unit_price));
  const customerValue = new Map<string, number>();
  for (const o of orders) customerValue.set(o.customer_id, (customerValue.get(o.customer_id) ?? 0) + (orderValue.get(o.order_id) ?? 0));
  const ranked = [...customerValue.entries()].sort((a, b) => b[1] - a[1]);
  const premiumCount = Math.round(ranked.length * PREMIUM_SHARE);
  await inChunks(
    ranked.map(([id, total], i) => ({ id, total, tier: i < premiumCount ? ("Premium" as const) : ("Standard" as const) })),
    5000,
    (c) => db.customer.createMany({ data: c.map((x) => ({ id: x.id, tier: x.tier, totalValue: Math.round(x.total), penaltyPctPerDay: PENALTY[x.tier] })) }),
  );
  log(`customers: ${ranked.length} (${premiumCount} Premium)`);

  await inChunks(orders, 5000, (c) =>
    db.order.createMany({
      data: c.map((r) => ({
        id: r.order_id, customerId: r.customer_id, warehouseId: r.warehouse_id, deliveryCity: r.delivery_city,
        createdAt: ts(r.order_created_at, shift)!, deadline: ts(r.delivery_deadline, shift)!, priority: r.priority, status: r.order_status,
      })),
    }),
  );
  await inChunks(items, 10000, (c) =>
    db.orderItem.createMany({ data: c.map((r) => ({ id: r.order_item_id, orderId: r.order_id, productId: r.product_id, quantity: num(r.quantity), unitPrice: num(r.unit_price) })) }),
  );
  log(`orders: ${orders.length}, order items: ${items.length}`);

  await loadActivityData(db, shift, log);
  await db.meta.create({ data: { key: "dataShiftMs", value: String(shift) } });
  await startScenarios(db, log);
}

// Demo reset: clears all activity and reloads stock, shipments and events. Orders, customers and
// products don't change during the workflow, so they stay; their dates are re-anchored to now.
export async function resetDemo(db: PrismaClient, log: (s: string) => void = () => {}) {
  const old = Number((await db.meta.findUnique({ where: { key: "dataShiftMs" } }))?.value ?? 0);
  const shift = Date.now() - ANCHOR.getTime();
  const delta = shift - old;
  await db.$executeRawUnsafe(CLEAR_ACTIVITY);
  await db.$executeRaw`UPDATE "Order" SET "deadline" = "deadline" + make_interval(secs => ${delta / 1000}), "createdAt" = "createdAt" + make_interval(secs => ${delta / 1000})`;
  await db.supplier.updateMany({ data: { active: true } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await loadActivityData(db, shift, log);
  await db.meta.upsert({ where: { key: "dataShiftMs" }, update: { value: String(shift) }, create: { key: "dataShiftMs", value: String(shift) } });
  await startScenarios(db, log);
}
