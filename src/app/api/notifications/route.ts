import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { iso } from "@/lib/records";

// Notifications addressed to me or to my role.
export const GET = route(async () => {
  const user = await requireUser();
  const rows = await db.notification.findMany({
    where: { OR: [{ targetUserId: user.id }, { targetRole: user.role }] },
    orderBy: { id: "desc" },
    take: 15,
  });
  return { notifications: rows.map((n) => ({ id: n.id, at: iso(n.at), message: n.message, severity: n.severity })) };
});
