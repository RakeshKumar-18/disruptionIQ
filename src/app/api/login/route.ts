import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";
import { verifyPin } from "@/lib/pin";
import { audit } from "@/lib/records";

const Body = z.object({ user: z.string().min(1).max(64), pin: z.string().min(1).max(32) });

export const POST = route(async (req) => {
  const { user: id, pin } = Body.parse(await readJson(req));
  const u = await db.user.findUnique({ where: { id } });
  if (!u || !verifyPin(pin, u.pinHash)) throw new ApiError(401, "Check the demo account and PIN.");
  await createSession(u.id);
  await audit(db, u.name, "LOGIN", "session", u.role);
  return { user: { id: u.id, name: u.name, role: u.role } };
});
