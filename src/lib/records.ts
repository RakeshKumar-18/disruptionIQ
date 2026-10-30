import type { Tx } from "./db";

export async function audit(tx: Tx, actor: string, action: string, entity: string, detail: string) {
  await tx.auditLog.create({ data: { actor, action, entity, detail } });
}

export async function notify(tx: Tx, message: string, severity: "info" | "success" | "warning" | "critical" = "info") {
  await tx.notification.create({ data: { message, severity } });
}

// Next readable ID from an atomic counter, e.g. nextId(tx, "plan", "PLAN") -> "PLAN-702".
export async function nextId(tx: Tx, counter: string, prefix: string): Promise<string> {
  const c = await tx.counter.update({ where: { name: counter }, data: { value: { increment: 1 } } });
  return `${prefix}-${c.value}`;
}

// Dates the UI expects: due dates as YYYY-MM-DD, everything else as ISO strings.
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
