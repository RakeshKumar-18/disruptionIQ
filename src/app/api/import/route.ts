import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, isUniqueViolation, readJson, route } from "@/lib/http";
import { audit, notify } from "@/lib/records";

const Body = z.object({
  filename: z.string().max(200).optional(),
  type: z.string(),
  rows: z.array(z.record(z.unknown())).max(5000),
});

class RowError extends Error {}
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const int = (v: unknown) => (str(v) === "" ? NaN : Number(str(v)));
const validDate = (v: unknown) => str(v) !== "" && !Number.isNaN(Date.parse(str(v)));
const PRIORITIES = ["Critical", "High", "Normal"];

// Each row is checked and saved on its own, so one bad row never blocks the good ones.
export const POST = route(async (req) => {
  const user = await requirePermission("import");
  const body = Body.parse(await readJson(req));
  if (!["orders", "inventory", "shipments"].includes(body.type)) {
    throw new ApiError(400, "Unsupported import type. Use orders, inventory or shipments.");
  }
  const [warehouses, suppliers] = await Promise.all([db.warehouse.findMany(), db.supplier.findMany()]);
  const whIds = new Set(warehouses.map((w) => w.id));
  const supIds = new Set(suppliers.map((s) => s.id));

  let accepted = 0, rejected = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    try {
      if (body.type === "orders") {
        const qty = int(r.qty), priority = str(r.priority) || "Normal";
        if (!str(r.id) || !str(r.sku) || !Number.isInteger(qty) || qty <= 0 || !validDate(r.due) || !whIds.has(str(r.warehouse_id)))
          throw new RowError("Required fields, positive integer qty, valid due date and known warehouse are required.");
        if (!PRIORITIES.includes(priority)) throw new RowError("Priority must be Critical, High or Normal.");
        const data = {
          customer: str(r.customer) || "Imported customer", sku: str(r.sku), qty, due: new Date(str(r.due).slice(0, 10)),
          warehouseId: str(r.warehouse_id), priority, status: "On track",
        };
        await db.order.upsert({ where: { id: str(r.id) }, update: data, create: { id: str(r.id), ...data } });
      } else if (body.type === "inventory") {
        const qty = int(r.qty), reserved = str(r.reserved) ? int(r.reserved) : 0, reorder = str(r.reorder_level) ? int(r.reorder_level) : 0;
        if (!str(r.id) || !str(r.sku) || !Number.isInteger(qty) || qty < 0 || !whIds.has(str(r.warehouse_id)))
          throw new RowError("Required fields, non-negative integer qty and known warehouse are required.");
        if (!Number.isInteger(reserved) || reserved < 0 || !Number.isInteger(reorder) || reorder < 0)
          throw new RowError("reserved and reorder_level must be non-negative integers.");
        const data = { sku: str(r.sku), product: str(r.product) || str(r.sku), warehouseId: str(r.warehouse_id), qty, reserved, reorderLevel: reorder };
        await db.inventoryItem.upsert({ where: { id: str(r.id) }, update: data, create: { id: str(r.id), ...data } });
      } else {
        if (!str(r.id) || !supIds.has(str(r.supplier_id)) || !validDate(r.eta))
          throw new RowError("Valid id, known supplier and ETA are required.");
        const eta = new Date(str(r.eta));
        const existing = await db.shipment.findUnique({ where: { id: str(r.id) } });
        if (existing) {
          if (eta < existing.eta) throw new RowError("Conflicting earlier ETA rejected.");
          await db.shipment.update({ where: { id: existing.id }, data: { eta, status: str(r.status) || existing.status } });
        } else {
          if (!str(r.carrier)) throw new RowError("carrier is required for a new shipment.");
          const delay = str(r.delay_days) ? int(r.delay_days) : 0;
          await db.shipment.create({
            data: {
              id: str(r.id), carrier: str(r.carrier), supplierId: str(r.supplier_id), origin: str(r.origin) || "Unknown",
              destination: str(r.destination) || "Unknown", eta, status: str(r.status) || "In transit",
              delayDays: Number.isInteger(delay) && delay >= 0 ? delay : 0,
            },
          });
        }
      }
      accepted++;
    } catch (e) {
      rejected++;
      const msg = e instanceof RowError ? e.message
        : isUniqueViolation(e) ? "Another row already uses this SKU and warehouse."
        : "Row could not be saved.";
      errors.push({ row: i + 1, error: msg });
    }
  }

  await db.$transaction(async (tx) => {
    await audit(tx, user.name, "DATA_IMPORTED", body.filename || "upload", `${accepted} accepted, ${rejected} rejected.`);
    await notify(tx, `CSV/JSON import: ${accepted} accepted, ${rejected} rejected.`, rejected ? "warning" : "success");
  });
  return { accepted, rejected, errors };
});
