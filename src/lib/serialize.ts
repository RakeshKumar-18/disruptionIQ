// Turns database rows into the snake_case JSON shape the UI already uses.
import type { AuditLog, Disruption, InventoryItem, Notification, Order, Plan, Shipment, Supplier, User, Warehouse } from "@prisma/client";
import { iso, ymd } from "./records";

export const supplierOut = (s: Supplier) => ({ id: s.id, name: s.name, region: s.region, lead_days: s.leadDays, status: s.status });

export const warehouseOut = (w: Warehouse) => ({ id: w.id, name: w.name, region: w.region });

export const inventoryOut = (i: InventoryItem & { warehouse?: Warehouse }) => ({
  id: i.id, sku: i.sku, product: i.product, warehouse_id: i.warehouseId, qty: i.qty, reserved: i.reserved,
  reorder_level: i.reorderLevel, warehouse: i.warehouse?.name,
});

export const shipmentOut = (s: Shipment & { supplier?: Supplier }) => ({
  id: s.id, carrier: s.carrier, supplier_id: s.supplierId, origin: s.origin, destination: s.destination,
  eta: iso(s.eta), status: s.status, delay_days: s.delayDays, event_id: s.lastEventId, supplier: s.supplier?.name,
});

export const orderOut = (o: Order) => ({
  id: o.id, customer: o.customer, sku: o.sku, qty: o.qty, due: ymd(o.due), warehouse_id: o.warehouseId,
  priority: o.priority, status: o.status, created_at: iso(o.createdAt),
});

export const disruptionOut = (d: Disruption & { shipment?: Shipment | null }) => ({
  id: d.id, title: d.title, type: d.type, severity: d.severity, description: d.description, shipment_id: d.shipmentId,
  affected_skus: d.affectedSkus, status: d.status, created_at: iso(d.createdAt),
  carrier: d.shipment?.carrier, eta: iso(d.shipment?.eta),
});

export const planOut = (
  p: Plan & { disruption?: Disruption; order?: Order; createdBy?: User; approvedBy?: User | null },
) => ({
  id: p.id, disruption_id: p.disruptionId, order_id: p.orderId, kind: p.kind, summary: p.summary, impact: p.impact,
  status: p.status, created_by: p.createdById, created_by_name: p.createdBy?.name, approved_by: p.approvedById,
  approved_by_name: p.approvedBy?.name ?? null, created_at: iso(p.createdAt), executed_at: iso(p.executedAt),
  disruption_title: p.disruption?.title ?? "Disruption", customer: p.order?.customer ?? "Customer",
});

export const notificationOut = (n: Notification) => ({ id: n.id, at: iso(n.at), message: n.message, severity: n.severity, read: n.read });

export const auditOut = (a: AuditLog) => ({ id: a.id, at: iso(a.at), actor: a.actor, action: a.action, entity: a.entity, detail: a.detail });
