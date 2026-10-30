import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { badges } from "@/lib/views";

// Polled every few seconds by every open screen. `v` changes whenever anyone does anything
// (every action writes an audit row), so screens refresh only when something actually changed.
export const GET = route(async () => {
  const user = await requireUser();
  const last = await db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  return { v: last?.id ?? 0, badges: await badges(user) };
});
