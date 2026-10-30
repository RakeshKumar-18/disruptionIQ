import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { EVENT_TYPES, processEvent } from "@/lib/engine/events";
import { ApiError, readJson, route } from "@/lib/http";
import { can } from "@/lib/roles";

export const maxDuration = 60;

const Body = z.object({
  event_id: z.string().trim().min(1).max(100),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  event_type: z.string().refine((t) => t in EVENT_TYPES, "unknown event type"),
  shipment_id: z.string().trim().min(1).max(64),
  event_timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be a valid date").optional(),
  location: z.string().trim().max(100).optional(),
  delay_days: z.coerce.number().int().min(0).max(60).default(0),
});

function secretMatches(given: string | null): boolean {
  const expected = process.env.WEBHOOK_SECRET;
  if (!given || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Real carriers send the x-webhook-secret header. A signed-in Administrator may also call it.
// Same fields as data/carrier_webhook_events.csv. Duplicates are detected by idempotency_key.
export const POST = route(async (req) => {
  let actor = "Carrier webhook";
  if (!secretMatches(req.headers.get("x-webhook-secret"))) {
    const u = await currentUser();
    if (!u || !can(u.role, "simulate")) throw new ApiError(401, "Missing or wrong webhook secret.");
    actor = `Carrier webhook (sent by ${u.name})`;
  }
  const b = Body.parse(await readJson(req));
  return processEvent(
    {
      event_id: b.event_id, idempotency_key: b.idempotency_key ?? b.event_id, event_type: b.event_type, shipment_id: b.shipment_id,
      event_timestamp: b.event_timestamp ?? new Date().toISOString(), location: b.location, delay_days: b.delay_days,
    },
    actor,
  );
});
