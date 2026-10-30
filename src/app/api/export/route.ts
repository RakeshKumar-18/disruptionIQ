import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { iso } from "@/lib/records";
import {
  auditOut, disruptionOut, inventoryOut, notificationOut, orderOut, planOut, shipmentOut, supplierOut, warehouseOut,
} from "@/lib/serialize";

// Full data export. Never includes PIN hashes or session tokens.
export const GET = route(async () => {
  await requirePermission("view");
  const [users, suppliers, warehouses, inventory, shipments, orders, disruptions, plans, events, notifications, auditRows] =
    await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true }, orderBy: { id: "asc" } }),
      db.supplier.findMany({ orderBy: { id: "asc" } }),
      db.warehouse.findMany({ orderBy: { id: "asc" } }),
      db.inventoryItem.findMany({ orderBy: { id: "asc" } }),
      db.shipment.findMany({ orderBy: { id: "asc" } }),
      db.order.findMany({ orderBy: { id: "asc" } }),
      db.disruption.findMany({ orderBy: { createdAt: "desc" } }),
      db.plan.findMany({ orderBy: { createdAt: "desc" } }),
      db.carrierEvent.findMany({ orderBy: { receivedAt: "desc" } }),
      db.notification.findMany({ orderBy: { at: "desc" } }),
      db.auditLog.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }] }),
    ]);
  return {
    exported_at: new Date().toISOString(),
    users,
    suppliers: suppliers.map(supplierOut),
    warehouses: warehouses.map(warehouseOut),
    inventory: inventory.map(inventoryOut),
    shipments: shipments.map(shipmentOut),
    orders: orders.map(orderOut),
    disruptions: disruptions.map(disruptionOut),
    plans: plans.map(planOut),
    events: events.map((e) => ({ event_id: e.eventId, shipment_id: e.shipmentId, eta: iso(e.eta), status: e.status, received_at: iso(e.receivedAt), payload: e.payload })),
    notifications: notifications.map(notificationOut),
    audit: auditRows.map(auditOut),
  };
});
