import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildOptions } from "@/lib/engine/options";
import { ApiError, readJson, route } from "@/lib/http";
import { audit, inr, nextId, notify } from "@/lib/records";
import { PLAN_KINDS } from "@/lib/roles";
import { plansFor } from "@/lib/views";

export const GET = route(async (req) => {
  const user = await requireUser();
  const view = new URL(req.url).searchParams.get("view") ?? "";
  const plans = await plansFor(user, view);
  if (!plans) throw new ApiError(403, `${user.role} cannot see this list.`);
  return { plans };
});

const Body = z.object({ disruptionId: z.string().min(1), orderId: z.string().min(1), kind: z.enum(PLAN_KINDS) });

// The client only says which option it wants. The server rebuilds the options from live data and
// stores its own numbers, so a plan can never contain stock or costs the rules didn't produce.
export const POST = route(async (req) => {
  const user = await requirePermission("submit");
  const b = Body.parse(await readJson(req));
  const option = (await buildOptions(db, b.disruptionId, b.orderId)).find((o) => o.kind === b.kind);
  if (!option) throw new ApiError(400, "That option is not available for this order.");
  if (!option.feasible) throw new ApiError(409, `Not possible any more: ${option.reason}`);

  const plan = await db.$transaction(async (tx) => {
    const link = await tx.disruptionOrder.findUniqueOrThrow({ where: { disruptionId_orderId: { disruptionId: b.disruptionId, orderId: b.orderId } } });
    if (link.status !== "At risk") throw new ApiError(409, "This order is already being recovered.");
    const open = await tx.plan.findFirst({
      where: { disruptionId: b.disruptionId, orderId: b.orderId, status: { in: ["Pending approval", "Changes proposed", "Approved"] } },
    });
    if (open) throw new ApiError(409, `${open.id} is already in progress for this order.`);
    const id = await nextId(tx, "plan", "PLAN");
    const p = await tx.plan.create({
      data: {
        id, disruptionId: b.disruptionId, orderId: b.orderId, kind: option.kind, approverRole: option.approverRole,
        summary: option.summary, details: option.details as Prisma.InputJsonValue, costInr: option.costInr,
        status: "Pending approval", createdById: user.id,
      },
    });
    await audit(tx, user.name, "PLAN_SUBMITTED", id, `${p.kind} for ${p.orderId} (${inr(p.costInr)}): ${p.summary}. Sent to ${p.approverRole}.`);
    await notify(tx, { role: option.approverRole }, `${id} needs your approval: ${p.kind} for order ${p.orderId} (${inr(p.costInr)}).`, "warning");
    return p;
  });
  return { id: plan.id, approverRole: plan.approverRole };
});
