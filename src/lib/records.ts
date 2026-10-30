import type { Tx } from "./db";
import type { RoleName } from "./roles";

export async function audit(tx: Tx, actor: string, action: string, entity: string, detail: string) {
  await tx.auditLog.create({ data: { actor, action, entity, detail } });
}

type Target = { role?: RoleName; userId?: string };

// A notification shown to one role or one user.
export async function notify(
  tx: Tx,
  target: Target,
  message: string,
  severity: "info" | "success" | "warning" | "critical" = "info",
) {
  await tx.notification.create({
    data: { targetRole: target.role ?? null, targetUserId: target.userId ?? null, message, severity },
  });
}

// Next readable ID from an atomic counter, e.g. nextId(tx, "plan", "PLAN") -> "PLAN-1002".
export async function nextId(tx: Tx, counter: string, prefix: string): Promise<string> {
  const c = await tx.counter.update({ where: { name: counter }, data: { value: { increment: 1 } } });
  return `${prefix}-${c.value}`;
}

export const DAY_MS = 86_400_000;
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY_MS);

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
