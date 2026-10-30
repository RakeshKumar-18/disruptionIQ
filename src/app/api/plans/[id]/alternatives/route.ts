import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildOptions } from "@/lib/engine/options";
import { ApiError, route } from "@/lib/http";
import { reviewRolesFor, type RoleName } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// For an approver: the other options for this order they could propose instead
// (only options of the same approval type as the plan).
export const GET = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const plan = await db.plan.findUnique({ where: { id: (await params).id } });
  if (!plan) throw new ApiError(404, "Plan not found.");
  if (!reviewRolesFor(user.role).includes(plan.approverRole as RoleName)) throw new ApiError(403, "Only this plan's approver can see its alternatives.");
  const options = await buildOptions(db, plan.disruptionId, plan.orderId);
  return { options: options.filter((o) => o.approverRole === plan.approverRole && o.kind !== plan.kind) };
});
