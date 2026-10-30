import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { EVENT_TYPES, processEvent } from "@/lib/engine/events";
import { ApiError, readJson, route } from "@/lib/http";
import { audit, notify } from "@/lib/records";

export const maxDuration = 60;

const Body = z.object({
  filename: z.string().max(200).optional(),
  type: z.enum(["inventory", "carrier_events"]),
  rows: z.array(z.record(z.unknown())).min(1).max(2000),
});

class RowError extends Error {}
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const int = (v: unknown) => (str(v) === "" ? NaN : Number(str(v)));

// Same column names as the dataset files:
//  inventory       -> inventory.csv (warehouse_id, product_id, on_hand_qty, reserved_qty, inbound_qty)
//  carrier_events  -> carrier_webhook_events.csv (each row goes through the webhook pipeline,
//                     so duplicates, stale and conflicting events are handled exactly the same way)
// Each row is checked on its own: one bad row never blocks the good ones.
export const POST = route(async (req) => {
  const user = await requirePermission("import");
  const body = Body.parse(await readJson(req));
  const [warehouses, products] = await Promise.all([db.warehouse.findMany({ select: { id: true } }), db.product.findMany({ select: { id: true } })]);
  const wh = new Set(warehouses.map((w) => w.id));
  const pr = new Set(products.map((p) => p.id));
  let accepted = 0, rejected = 0;
  const errors: { row: number; error: string }[] = [];
  const outcomes: Record<string, number> = {};

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    try {
      if (body.type === "inventory") {
        const onHand = int(r.on_hand_qty), reserved = str(r.reserved_qty) ? int(r.reserved_qty) : 0, inbound = str(r.inbound_qty) ? int(r.inbound_qty) : 0;
        if (!wh.has(str(r.warehouse_id))) throw new RowError(`Unknown warehouse "${str(r.warehouse_id)}".`);
        if (!pr.has(str(r.product_id))) throw new RowError(`Unknown product "${str(r.product_id)}".`);
        if (![onHand, reserved, inbound].every((n) => Number.isInteger(n) && n >= 0)) throw new RowError("Quantities must be whole numbers, 0 or more.");
        if (reserved > onHand) throw new RowError("reserved_qty can't be more than on_hand_qty.");
        await db.inventory.update({
          where: { warehouseId_productId: { warehouseId: str(r.warehouse_id), productId: str(r.product_id) } },
          data: { onHand, reserved, inbound, updatedAt: new Date() },
        });
      } else {
        const type = str(r.event_type);
        if (!str(r.event_id) || !str(r.shipment_id)) throw new RowError("event_id and shipment_id are required.");
        if (!(type in EVENT_TYPES)) throw new RowError(`Unknown event_type "${type}".`);
        const delay = str(r.delay_days) ? int(r.delay_days) : 0;
        if (!Number.isInteger(delay) || delay < 0 || delay > 60) throw new RowError("delay_days must be a whole number from 0 to 60.");
        const when = str(r.event_timestamp);
        if (when && Number.isNaN(Date.parse(when.replace(" ", "T")))) throw new RowError("event_timestamp is not a valid date.");
        const res = await processEvent(
          {
            event_id: str(r.event_id), idempotency_key: str(r.idempotency_key) || str(r.event_id), event_type: type, shipment_id: str(r.shipment_id),
            event_timestamp: when ? new Date(when.replace(" ", "T")).toISOString() : new Date().toISOString(), location: str(r.location) || undefined, delay_days: delay,
          },
          `Import (${user.name})`,
        );
        outcomes[res.outcome] = (outcomes[res.outcome] ?? 0) + 1;
      }
      accepted++;
    } catch (e) {
      rejected++;
      errors.push({ row: i + 1, error: e instanceof RowError || e instanceof ApiError ? e.message : "Row could not be saved." });
    }
  }

  await db.$transaction(async (tx) => {
    await audit(tx, user.name, "DATA_IMPORTED", body.filename || body.type, `${body.type}: ${accepted} accepted, ${rejected} rejected.`);
    await notify(tx, { role: "Administrator" }, `Import of ${body.filename || body.type}: ${accepted} accepted, ${rejected} rejected.`, rejected ? "warning" : "success");
  });
  return { accepted, rejected, errors: errors.slice(0, 50), outcomes };
});
