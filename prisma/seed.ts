// Resets the database to the demo state (same synthetic data as the browser prototype).
// Run: npm run db:seed
import { PrismaClient } from "@prisma/client";
import { hashPin } from "../src/lib/pin";

const db = new PrismaClient();
const day = (n: number) => new Date(Date.now() + n * 86400000);
const date = (n: number) => new Date(day(n).toISOString().slice(0, 10)); // date only, for due dates

async function main() {
  // Clear in dependency order.
  await db.$transaction([
    db.session.deleteMany(),
    db.plan.deleteMany(),
    db.disruption.deleteMany(),
    db.carrierEvent.deleteMany(),
    db.order.deleteMany(),
    db.inventoryItem.deleteMany(),
    db.shipment.deleteMany(),
    db.supplier.deleteMany(),
    db.warehouse.deleteMany(),
    db.notification.deleteMany(),
    db.auditLog.deleteMany(),
    db.counter.deleteMany(),
    db.user.deleteMany(),
  ]);

  const users = [
    { id: "u-analyst", name: "Rakesh", role: "Operations Analyst", pin: "1111" },
    { id: "u-manager", name: "Varsha", role: "Supply Chain Manager", pin: "2222" },
    { id: "u-warehouse", name: "Tristan", role: "Warehouse Operator", pin: "3333" },
    { id: "u-procurement", name: "Joshita", role: "Procurement Approver", pin: "4444" },
    { id: "u-admin", name: "Administrator", role: "Administrator", pin: "9999" },
  ];
  await db.user.createMany({ data: users.map(({ pin, ...u }) => ({ ...u, pinHash: hashPin(pin) })) });

  await db.supplier.createMany({
    data: [
      { id: "SUP-01", name: "Northstar Components", region: "Shenzhen, CN", leadDays: 18, status: "At risk" },
      { id: "SUP-02", name: "Pacific Plastics Co.", region: "Taipei, TW", leadDays: 12, status: "On time" },
      { id: "SUP-03", name: "Apex Electronics", region: "Austin, US", leadDays: 5, status: "On time" },
      { id: "SUP-04", name: "Meridian Freight Goods", region: "Rotterdam, NL", leadDays: 14, status: "At risk" },
    ],
  });

  await db.warehouse.createMany({
    data: [
      { id: "WH-SEA", name: "Seattle Fulfillment", region: "Seattle, US" },
      { id: "WH-CHI", name: "Chicago Distribution", region: "Chicago, US" },
      { id: "WH-EWR", name: "Newark Hub", region: "Newark, US" },
    ],
  });

  await db.inventoryItem.createMany({
    data: [
      { id: "INV-01", sku: "SKU-441", product: "Smart sensor module", warehouseId: "WH-SEA", qty: 45, reserved: 36, reorderLevel: 30 },
      { id: "INV-02", sku: "SKU-441", product: "Smart sensor module", warehouseId: "WH-CHI", qty: 70, reserved: 42, reorderLevel: 30 },
      { id: "INV-03", sku: "SKU-882", product: "Control unit v2", warehouseId: "WH-EWR", qty: 28, reserved: 22, reorderLevel: 24 },
      { id: "INV-04", sku: "SKU-882", product: "Control unit v2", warehouseId: "WH-CHI", qty: 54, reserved: 39, reorderLevel: 24 },
      { id: "INV-05", sku: "SKU-310", product: "Power adapter kit", warehouseId: "WH-SEA", qty: 120, reserved: 34, reorderLevel: 25 },
      { id: "INV-06", sku: "SKU-725", product: "Gateway board", warehouseId: "WH-EWR", qty: 18, reserved: 11, reorderLevel: 20 },
      { id: "INV-07", sku: "SKU-725", product: "Gateway board", warehouseId: "WH-SEA", qty: 62, reserved: 22, reorderLevel: 20 },
    ],
  });

  await db.shipment.createMany({
    data: [
      { id: "SHP-2041", carrier: "Maersk", supplierId: "SUP-01", origin: "Yantian, CN", destination: "Seattle, US", eta: day(4), status: "Delayed", delayDays: 5, lastEventId: "evt-init-1" },
      { id: "SHP-2042", carrier: "FedEx Freight", supplierId: "SUP-02", origin: "Taipei, TW", destination: "Chicago, US", eta: day(2), status: "In transit", delayDays: 0, lastEventId: "evt-init-2" },
      { id: "SHP-2043", carrier: "UPS Supply Chain", supplierId: "SUP-04", origin: "Rotterdam, NL", destination: "Newark, US", eta: day(1), status: "In transit", delayDays: 0, lastEventId: "evt-init-3" },
      { id: "SHP-2044", carrier: "DHL Express", supplierId: "SUP-03", origin: "Austin, US", destination: "Chicago, US", eta: day(0), status: "In transit", delayDays: 0, lastEventId: "evt-init-4" },
    ],
  });

  const orders: [string, string, string, number, number, string, string][] = [
    ["ORD-8821", "Acme Robotics", "SKU-441", 24, 5, "WH-SEA", "Critical"],
    ["ORD-8822", "Vertex Systems", "SKU-441", 30, 6, "WH-SEA", "High"],
    ["ORD-8823", "Helix Industrial", "SKU-441", 20, 8, "WH-CHI", "High"],
    ["ORD-8816", "Nova Medical", "SKU-882", 18, 2, "WH-EWR", "Critical"],
    ["ORD-8817", "Pioneer Labs", "SKU-882", 16, 4, "WH-EWR", "High"],
    ["ORD-8825", "Cobalt Manufacturing", "SKU-725", 14, 3, "WH-EWR", "High"],
    ["ORD-8826", "Atlas Dynamics", "SKU-310", 20, 9, "WH-SEA", "Normal"],
    ["ORD-8802", "Brightline Devices", "SKU-441", 10, 3, "WH-CHI", "Normal"],
    ["ORD-8803", "Kinetic Motion", "SKU-882", 8, 7, "WH-CHI", "Normal"],
    ["ORD-8827", "Luma Energy", "SKU-441", 12, 10, "WH-CHI", "Normal"],
  ];
  await db.order.createMany({
    data: orders.map(([id, customer, sku, qty, dueIn, warehouseId, priority], i) => ({
      id, customer, sku, qty, due: date(dueIn), warehouseId, priority,
      status: i < 6 ? "At risk" : "On track",
      createdAt: day(-1),
    })),
  });

  await db.disruption.createMany({
    data: [
      {
        id: "DIS-301", title: "Northstar sea freight +5 days", type: "Late shipment", severity: "Critical",
        description: "Maersk updated SHP-2041 ETA by 5 days. 3 orders / 74 units exposed; Seattle available stock covers 9 units after reservations.",
        shipmentId: "SHP-2041", affectedSkus: ["SKU-441"], createdAt: day(-0.2),
      },
      {
        id: "DIS-302", title: "Meridian supply allocation shortfall", type: "Supplier delay", severity: "High",
        description: "Meridian allocation is behind schedule; Newark gateway inventory is below reorder level. 3 orders / 46 units need review.",
        shipmentId: "SHP-2043", affectedSkus: ["SKU-882", "SKU-725"], createdAt: day(-0.1),
      },
    ],
  });

  await db.plan.create({
    data: {
      id: "PLAN-701", disruptionId: "DIS-301", orderId: "ORD-8821", kind: "Reallocate stock",
      summary: "Reserve 15 units from Chicago to Seattle, then ship 9 units from the delayed inbound when received.",
      impact: "Protects critical customer date; $180 transfer cost",
      status: "Approved", createdById: "u-analyst", approvedById: "u-manager",
      createdAt: day(-0.1), executedAt: day(-0.08),
    },
  });

  await db.counter.createMany({ data: [{ name: "plan", value: 701 }, { name: "disruption", value: 302 }] });
  await db.notification.create({
    data: { at: day(-0.1), message: "2 active disruptions are affecting 6 priority orders. Recovery plans are ready for review.", severity: "critical" },
  });
  await db.auditLog.create({
    data: { at: day(-0.2), actor: "system", action: "DEMO_SEEDED", entity: "workspace", detail: "Seeded synthetic network data and two disruption scenarios." },
  });

  console.log("Demo data seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
