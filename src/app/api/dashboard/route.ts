import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { permissionsFor } from "@/lib/rbac";
import {
  auditOut, disruptionOut, inventoryOut, notificationOut, orderOut, planOut, shipmentOut, supplierOut, warehouseOut,
} from "@/lib/serialize";

const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2 };

export const GET = route(async () => {
  const user = await requirePermission("view");
  const [disruptions, atRisk, plans, inventory, shipments, suppliers, warehouses, notifications, auditRows] = await Promise.all([
    db.disruption.findMany({ orderBy: { createdAt: "desc" }, include: { shipment: true } }),
    db.order.findMany({ where: { status: "At risk" } }),
    db.plan.findMany({ orderBy: { createdAt: "desc" }, include: { disruption: true, order: true, createdBy: true, approvedBy: true } }),
    db.inventoryItem.findMany({ orderBy: { id: "asc" }, include: { warehouse: true } }),
    db.shipment.findMany({ orderBy: { id: "asc" }, include: { supplier: true } }),
    db.supplier.findMany({ orderBy: { id: "asc" } }),
    db.warehouse.findMany({ orderBy: { id: "asc" } }),
    db.notification.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: 8 }),
    db.auditLog.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: 50 }),
  ]);

  const orders = atRisk
    .map((o) => {
      const stock = inventory.find((i) => i.sku === o.sku && i.warehouseId === o.warehouseId);
      return {
        ...orderOut(o),
        product: inventory.find((i) => i.sku === o.sku)?.product,
        available: stock ? stock.qty - stock.reserved : 0,
      };
    })
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.due.localeCompare(b.due));

  return {
    user,
    permissions: permissionsFor(user.role),
    kpis: {
      active: disruptions.filter((d) => d.status === "Active").length,
      affected: orders.length,
      pending: plans.filter((p) => p.status === "Pending approval").length,
      recovering: plans.filter((p) => ["Approved", "Executing", "Executed"].includes(p.status)).length,
    },
    disruptions: disruptions.map(disruptionOut),
    orders,
    plans: plans.map(planOut),
    suppliers: suppliers.map(supplierOut),
    warehouses: warehouses.map(warehouseOut),
    inventory: inventory.map(inventoryOut),
    shipments: shipments.map(shipmentOut),
    notifications: notifications.map(notificationOut),
    audit: auditRows.map(auditOut),
  };
});
