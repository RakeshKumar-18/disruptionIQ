import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyPlan, Blocked, recheck } from "@/lib/engine/execute";
import { buildOptions, type RecoveryOption } from "@/lib/engine/options";
import { ApiError, readJson, route } from "@/lib/http";
import { audit, inr, notify } from "@/lib/records";
import { APPROVER_FOR, PLAN_KINDS, reviewRolesFor, type RoleName } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string; action: string }> };

const RejectBody = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(300) });
const ProposeBody = z.object({ kind: z.enum(PLAN_KINDS), note: z.string().trim().max(300).optional() });

// Every status change is conditional on the current status, so two people clicking at once
// can't both succeed: the second gets "409 already handled".
async function moveStatus(tx: Prisma.TransactionClient, id: string, from: string[], data: Prisma.PlanUncheckedUpdateManyInput) {
  const r = await tx.plan.updateMany({ where: { id, status: { in: from } }, data });
  if (r.count === 0) throw new ApiError(409, "This plan has already been handled by someone else. The screen will refresh.");
}

export const POST = route<Ctx>(async (req, { params }) => {
  const { id, action } = await params;
  const plan = await db.plan.findUnique({ where: { id } });
  if (!plan) throw new ApiError(404, "Plan not found.");

  // ---- approvers ----
  if (action === "approve" || action === "reject" || action === "propose") {
    const user = await requireUser();
    const roles = reviewRolesFor(user.role);
    if (roles.length === 0) throw new ApiError(403, `The ${user.role} role can’t review plans.`);
    if (!roles.includes(plan.approverRole as RoleName)) throw new ApiError(403, `${plan.kind} plans are reviewed by the ${plan.approverRole}.`);
    if (plan.createdById === user.id) throw new ApiError(403, "Separation of duties: you can't review a plan you requested.");

    if (action === "approve") {
      // Rules decide: a plan that live data no longer allows can't be approved.
      const reason = await recheck(db, plan);
      if (reason) throw new ApiError(409, `Can’t approve: the live check failed. ${reason} Reject it or propose a change instead.`);
      await db.$transaction(async (tx) => {
        await moveStatus(tx, id, ["Pending approval"], { status: "Approved", reviewedById: user.id, reviewedAt: new Date() });
        await audit(tx, user.name, "PLAN_APPROVED", id, `${plan.kind} for ${plan.orderId} approved (${inr(plan.costInr)}).`);
        await notify(tx, { userId: plan.createdById }, `${id} was approved by ${user.name}.`, "success");
        await notify(tx, { role: "Warehouse Operator" }, `${id} is approved and ready to execute.`, "info");
      });
      return { ok: true, status: "Approved" };
    }
    if (action === "reject") {
      const { reason } = RejectBody.parse(await readJson(req));
      await db.$transaction(async (tx) => {
        await moveStatus(tx, id, ["Pending approval"], { status: "Rejected", reviewedById: user.id, reviewedAt: new Date(), note: reason });
        await audit(tx, user.name, "PLAN_REJECTED", id, `Rejected: ${reason}`);
        await notify(tx, { userId: plan.createdById }, `${id} was rejected by ${user.name}: ${reason}`, "warning");
      });
      return { ok: true, status: "Rejected" };
    }
    // propose a different option of the approver's own kind
    const b = ProposeBody.parse(await readJson(req));
    if (APPROVER_FOR[b.kind] !== plan.approverRole) throw new ApiError(403, `You can only propose options of the same approval type (${plan.approverRole}).`);
    if (b.kind === plan.kind) throw new ApiError(400, "Choose a different option to propose.");
    const option = (await buildOptions(db, plan.disruptionId, plan.orderId)).find((o) => o.kind === b.kind);
    if (!option?.feasible) throw new ApiError(409, `That option is not possible: ${option?.reason ?? "not available"}`);
    await db.$transaction(async (tx) => {
      await moveStatus(tx, id, ["Pending approval"], {
        status: "Changes proposed", reviewedById: user.id, reviewedAt: new Date(), note: b.note ?? null,
        proposed: option as unknown as Prisma.InputJsonValue,
      });
      await audit(tx, user.name, "PLAN_CHANGE_PROPOSED", id, `Proposed ${option.kind} instead of ${plan.kind}: ${option.summary}`);
      await notify(tx, { userId: plan.createdById }, `${user.name} proposed a change to ${id}. Accept or withdraw it.`, "warning");
    });
    return { ok: true, status: "Changes proposed" };
  }

  // ---- requester ----
  if (action === "accept" || action === "withdraw") {
    const user = await requirePermission("submit");
    if (plan.createdById !== user.id) throw new ApiError(403, "Only the person who requested this plan can do that.");
    if (action === "withdraw") {
      await db.$transaction(async (tx) => {
        await moveStatus(tx, id, ["Pending approval", "Changes proposed", "Blocked"], { status: "Withdrawn" });
        await audit(tx, user.name, "PLAN_WITHDRAWN", id, `Withdrawn by the requester.`);
      });
      return { ok: true, status: "Withdrawn" };
    }
    const p = plan.proposed as unknown as RecoveryOption | null;
    if (!p) throw new ApiError(409, "There is no proposed change to accept.");
    await db.$transaction(async (tx) => {
      // The approver proposed it and the requester accepts it: two people agreed, so it is approved.
      await moveStatus(tx, id, ["Changes proposed"], {
        status: "Approved", kind: p.kind, approverRole: p.approverRole, summary: p.summary,
        details: p.details as Prisma.InputJsonValue, costInr: p.costInr, proposed: Prisma.DbNull,
      });
      await audit(tx, user.name, "PLAN_CHANGE_ACCEPTED", id, `Accepted the proposed ${p.kind}; plan approved.`);
      if (plan.reviewedById) await notify(tx, { userId: plan.reviewedById }, `${user.name} accepted your change to ${id}.`, "success");
      await notify(tx, { role: "Warehouse Operator" }, `${id} is approved and ready to execute.`, "info");
    });
    return { ok: true, status: "Approved" };
  }

  // ---- warehouse operator ----
  if (action === "execute") {
    const user = await requirePermission("execute");
    try {
      const done = await db.$transaction(
        async (tx) => {
          await moveStatus(tx, id, ["Approved"], { status: "Executed", executedById: user.id, executedAt: new Date() });
          const msg = await applyPlan(tx, plan);
          await audit(tx, user.name, "PLAN_EXECUTED_SIMULATED", id, `${msg} Simulation only; no external system was contacted.`);
          await notify(tx, { userId: plan.createdById }, `${id} was executed by ${user.name}.`, "success");
          return msg;
        },
        { timeout: 20_000 },
      );
      return { ok: true, status: "Executed", message: done };
    } catch (e) {
      if (!(e instanceof Blocked)) throw e;
      // Live data no longer allows it: nothing was changed. Block the plan and tell the requester.
      await db.$transaction(async (tx) => {
        await moveStatus(tx, id, ["Approved"], { status: "Blocked", note: e.message });
        await audit(tx, user.name, "PLAN_BLOCKED", id, `Stock recheck failed: ${e.message}`);
        await notify(tx, { userId: plan.createdById }, `${id} was blocked at execution: ${e.message}`, "critical");
      });
      return { ok: false, status: "Blocked", message: e.message };
    }
  }

  throw new ApiError(404, "Unknown action.");
});
