import { requirePermission } from "@/lib/auth";
import { ApiError, route } from "@/lib/http";
import { disruptionDetail } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  await requirePermission("view_network");
  const d = await disruptionDetail((await params).id);
  if (!d) throw new ApiError(404, "Disruption not found.");
  return d;
});
