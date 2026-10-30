import { currentUser, endSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { audit } from "@/lib/records";

export const POST = route(async () => {
  const u = await currentUser();
  await endSession();
  if (u) await audit(db, u.name, "LOGOUT", "session", "Signed out");
  return { ok: true };
});
