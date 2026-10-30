import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";
import { iso } from "@/lib/records";
import { pickEvent, SCENARIO_TYPES, sendInbound } from "@/lib/simulator";

export const maxDuration = 60;

export const GET = route(async () => {
  await requirePermission("simulate");
  const [counts, last] = await Promise.all([
    db.inboundEvent.groupBy({ by: ["type"], where: { sentAt: null }, _count: true }),
    db.inboundEvent.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" } }),
  ]);
  return {
    scenarios: SCENARIO_TYPES.map((s) => ({ ...s, waiting: counts.find((c) => c.type === s.type)?._count ?? 0 })),
    lastSent: last ? { eventId: last.eventId, type: last.type, shipmentId: last.shipmentId, idempotencyKey: last.idempotencyKey, sentAt: iso(last.sentAt) } : null,
  };
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), type: z.string() }),
  z.object({ action: z.literal("duplicate") }),
]);

export const POST = route(async (req) => {
  const user = await requirePermission("simulate");
  const b = Body.parse(await readJson(req));
  if (b.action === "send") {
    if (!SCENARIO_TYPES.some((s) => s.type === b.type)) throw new ApiError(400, "Unknown scenario.");
    const ev = await pickEvent(db, b.type);
    if (!ev) throw new ApiError(409, "No more events of this type that would affect open orders. Reset the demo to start over.");
    const result = await sendInbound(db, ev, `Simulator (${user.name})`);
    return { ...result, event: { eventId: ev.eventId, shipmentId: ev.shipmentId, location: ev.location, delayDays: ev.delayDays } };
  }
  // Re-send the last event with the same idempotency key, as a carrier retry would.
  const last = await db.inboundEvent.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" } });
  if (!last) throw new ApiError(409, "Send an event first, then send its duplicate.");
  const result = await sendInbound(db, last, `Simulator (${user.name})`, { duplicateOf: true });
  return { ...result, event: { eventId: `${last.eventId}-RESENT`, shipmentId: last.shipmentId, idempotencyKey: last.idempotencyKey } };
});
