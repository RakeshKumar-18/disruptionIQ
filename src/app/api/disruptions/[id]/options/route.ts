import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildOptions } from "@/lib/engine/options";
import { readJson, route } from "@/lib/http";
import { audit } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ orderId: z.string().min(1) });

export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requirePermission("recommend");
  const { id } = await params;
  const { orderId } = Body.parse(await readJson(req));
  const options = await buildOptions(db, id, orderId);
  await audit(db, user.name, "OPTIONS_GENERATED", `${id}/${orderId}`, `${options.filter((o) => o.feasible).length} of ${options.length} recovery options feasible.`);
  return { options };
});
