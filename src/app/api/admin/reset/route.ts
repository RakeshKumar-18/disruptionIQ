import { requirePermission } from "@/lib/auth";
import { resetDemo } from "@/lib/dataset";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { audit } from "@/lib/records";

export const maxDuration = 60;

export const POST = route(async () => {
  const user = await requirePermission("simulate");
  const lines: string[] = [];
  await resetDemo(db, (s) => lines.push(s));
  await audit(db, user.name, "DEMO_RESET", "workspace", `Demo reset to its starting state. ${lines.filter((l) => l.includes("DIS-")).join(" ")}`);
  return { ok: true, log: lines };
});
