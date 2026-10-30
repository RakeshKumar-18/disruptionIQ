import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";
import { PLAN_KINDS } from "@/lib/plans";
import { audit, nextId, notify } from "@/lib/records";

const Body = z.object({
  disruptionId: z.string().min(1),
  orderId: z.string().min(1),
  kind: z.enum(PLAN_KINDS),
  title: z.string().trim().min(1).max(500),
  impact: z.string().trim().max(500).default(""),
});

export const POST = route(async (req) => {
  const user = await requirePermission("submit");
  const b = Body.parse(await readJson(req));
  const [d, o] = await Promise.all([
    db.disruption.findUnique({ where: { id: b.disruptionId } }),
    db.order.findUnique({ where: { id: b.orderId } }),
  ]);
  if (!d) throw new ApiError(404, "Disruption not found.");
  if (!o) throw new ApiError(404, "Order not found.");

  const plan = await db.$transaction(async (tx) => {
    const id = await nextId(tx, "plan", "PLAN");
    const p = await tx.plan.create({
      data: { id, disruptionId: d.id, orderId: o.id, kind: b.kind, summary: b.title, impact: b.impact, status: "Pending approval", createdById: user.id },
    });
    await audit(tx, user.name, "PLAN_SUBMITTED", p.id, `${p.kind}: ${p.summary}. Awaiting a different authorized approver.`);
    await notify(tx, `${user.name} submitted ${p.kind} for ${p.orderId}; approval needed.`, "warning");
    return p;
  });
  return { id: plan.id, status: plan.status };
});
