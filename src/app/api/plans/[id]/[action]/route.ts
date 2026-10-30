import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";
import { PLAN_KINDS } from "@/lib/plans";
import { audit, notify } from "@/lib/records";

type Ctx = { params: Promise<{ id: string; action: string }> };

const ModifyBody = z.object({
  kind: z.enum(PLAN_KINDS).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
  impact: z.string().trim().max(500).optional(),
});

// Each status change is a conditional update ("only if still pending/approved"), so two people
// clicking at the same moment cannot both succeed.
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, action } = await params;
  if (!["approve", "reject", "modify", "execute"].includes(action)) throw new ApiError(404, "Not found.");
  const p = await db.plan.findUnique({ where: { id } });
  if (!p) throw new ApiError(404, "Plan not found.");

  if (action === "approve" || action === "reject") {
    const user = await requirePermission("approve");
    if (p.createdById === user.id) throw new ApiError(403, "Separation of duties: you cannot review your own recovery plan.");
    const status = action === "approve" ? "Approved" : "Rejected";
    await db.$transaction(async (tx) => {
      const r = await tx.plan.updateMany({ where: { id, status: "Pending approval" }, data: { status, approvedById: user.id } });
      if (r.count === 0) throw new ApiError(409, "Only pending plans can be reviewed.");
      await audit(tx, user.name, action === "approve" ? "PLAN_APPROVED" : "PLAN_REJECTED", id, "Reviewed by a different authorized user.");
      await notify(tx, `${id} ${action}d by ${user.name}.`, action === "approve" ? "success" : "warning");
    });
    return { ok: true, status };
  }

  if (action === "modify") {
    const user = await requirePermission("modify");
    if (p.createdById === user.id) throw new ApiError(403, "Separation of duties: the requester cannot modify their pending plan.");
    const b = ModifyBody.parse(await readJson(req));
    const kind = b.kind ?? p.kind, summary = b.summary ?? p.summary, impact = b.impact ?? p.impact;
    await db.$transaction(async (tx) => {
      const r = await tx.plan.updateMany({ where: { id, status: "Pending approval" }, data: { kind, summary, impact } });
      if (r.count === 0) throw new ApiError(409, "Only pending plans can be modified.");
      await audit(tx, user.name, "PLAN_MODIFIED", id, `Updated to ${kind}: ${summary}`);
    });
    return { ok: true, status: "Pending approval" };
  }

  // execute
  const user = await requirePermission("execute");
  await db.$transaction(async (tx) => {
    const r = await tx.plan.updateMany({ where: { id, status: "Approved" }, data: { status: "Executed", executedAt: new Date() } });
    if (r.count === 0) throw new ApiError(409, "Only approved plans can be executed.");
    await tx.order.update({ where: { id: p.orderId }, data: { status: "Recovering" } });
    await audit(tx, user.name, "PLAN_EXECUTED_SIMULATED", id, "Simulation only; no external system was contacted.");
    await notify(tx, `${id} simulated for ${p.orderId}.`, "success");
  });
  return { ok: true, status: "Executed" };
});
