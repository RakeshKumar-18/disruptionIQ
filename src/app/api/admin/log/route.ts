import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { iso } from "@/lib/records";

const PAGE = 50;
const EVENT_ACTIONS = ["EVENT_APPLIED", "EVENT_DUPLICATE", "EVENT_STALE", "EVENT_CONFLICT", "DISRUPTION_DETECTED"];

// ?kind=events (carrier events and what happened to each) or ?kind=audit (everything).
export const GET = route(async (req) => {
  await requirePermission("admin");
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const where: Prisma.AuditLogWhereInput = sp.get("kind") === "events" ? { action: { in: EVENT_ACTIONS } } : {};
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  return {
    total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: rows.map((r) => ({ id: r.id, at: iso(r.at), actor: r.actor, action: r.action, entity: r.entity, detail: r.detail })),
  };
});
