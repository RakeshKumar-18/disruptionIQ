import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";
import { audit, ymd } from "@/lib/records";

const Body = z.object({ disruptionId: z.string().min(1) });

// Rule-based recovery options (same templates as the prototype). Step 5 replaces these with
// feasibility-checked options and step 6 adds the AI explanation on top.
export const POST = route(async (req) => {
  const user = await requirePermission("recommend");
  const { disruptionId } = Body.parse(await readJson(req));
  const d = await db.disruption.findUnique({ where: { id: disruptionId } });
  if (!d) throw new ApiError(404, "Disruption not found.");

  const [affected, inventory] = await Promise.all([
    db.order.findMany({ where: { status: "At risk", sku: { in: d.affectedSkus } }, orderBy: { id: "asc" }, take: 4 }),
    db.inventoryItem.findMany(),
  ]);

  const options = affected.flatMap((o) => {
    const free = (i: (typeof inventory)[number]) => i.qty - i.reserved;
    const other = inventory.filter((i) => i.sku === o.sku && i.warehouseId !== o.warehouseId).reduce((n, i) => n + free(i), 0);
    const own = inventory.find((i) => i.sku === o.sku && i.warehouseId === o.warehouseId);
    const due = ymd(o.due);
    const base = { orderId: o.id, customer: o.customer, sku: o.sku, units: o.qty, due, disruptionId: d.id };
    const move = Math.min(o.qty, other);
    return [
      { ...base, kind: "Reallocate stock", title: `Move ${move} units from a nearby warehouse`, impact: `Protect ${o.customer}'s ${due} commitment using ${other} unreserved network units.`, cost: `$${move * 12} transfer` },
      { ...base, kind: "Expedite", title: "Upgrade inbound shipment to priority handling", impact: `Recover an estimated 2 days on ${o.id}; customer confirmation required if still late.`, cost: `$${o.qty * 8} expedite` },
      { ...base, kind: "Alternative supplier", title: "Request a partial fill from an approved backup supplier", impact: `Cover ${Math.floor(o.qty * 0.6)} units while the original supplier recovers.`, cost: `$${o.qty * 15} premium` },
      { ...base, kind: "Split order", title: "Ship available units now and backorder the balance", impact: `Deliver ${Math.min(o.qty, Math.max(0, own ? free(own) : 0))} units by the original date; remaining balance follows inbound.`, cost: "No transfer fee" },
    ];
  });

  await audit(db, user.name, "RECOVERY_OPTIONS_GENERATED", d.id, `${options.length} rule-based recovery options generated.`);
  return {
    options,
    generatedAt: new Date().toISOString(),
    basis: "Live order commitments, unreserved inventory across warehouses, supplier lead times and disruption severity.",
  };
});
