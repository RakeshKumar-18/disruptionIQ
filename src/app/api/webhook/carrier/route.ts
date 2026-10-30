import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, isUniqueViolation, readJson, route } from "@/lib/http";
import { audit, nextId, notify } from "@/lib/records";

const Body = z.object({
  event_id: z.string().trim().min(1).max(100),
  shipment_id: z.string().trim().min(1).max(64),
  eta: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be a valid date"),
  status: z.string().trim().max(40).optional(),
  authoritative: z.boolean().optional(),
});

function secretMatches(given: string | null): boolean {
  const expected = process.env.WEBHOOK_SECRET;
  if (!given || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Carriers call this with the x-webhook-secret header. The in-app "Simulate webhook" button
// calls it with a signed-in session instead, and the audit log records who simulated it.
export const POST = route(async (req) => {
  let actor = "Carrier webhook";
  if (!secretMatches(req.headers.get("x-webhook-secret"))) {
    const u = await currentUser();
    if (!u) throw new ApiError(401, "Missing or wrong webhook secret.");
    actor = `Carrier webhook (simulated by ${u.name})`;
  }

  const b = Body.parse(await readJson(req));
  const duplicate = { ok: true, duplicate: true, message: "Duplicate event ignored safely." };
  if (await db.carrierEvent.findUnique({ where: { eventId: b.event_id } })) return duplicate;

  const s = await db.shipment.findUnique({ where: { id: b.shipment_id } });
  if (!s) throw new ApiError(404, "Unknown shipment.");
  const eta = new Date(b.eta);
  if (eta < s.eta && !b.authoritative) throw new ApiError(409, "Conflicting earlier ETA rejected.");

  const daysOut = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);
  const delta = Math.max(0, daysOut(eta) - daysOut(s.eta));

  try {
    await db.$transaction(async (tx) => {
      // The eventId primary key makes this insert fail if the same event arrives twice at once.
      await tx.carrierEvent.create({
        data: { eventId: b.event_id, shipmentId: s.id, eta, status: b.status ?? null, payload: b as Prisma.InputJsonValue },
      });
      await tx.shipment.update({
        where: { id: s.id },
        data: { eta, delayDays: delta, status: b.status || "Delayed", lastEventId: b.event_id },
      });
      if (delta >= 1) {
        const id = await nextId(tx, "disruption", "DIS");
        await tx.disruption.create({
          data: {
            id, title: `${s.carrier} ETA moved by ${delta} days`, type: "Late shipment", severity: delta >= 3 ? "High" : "Medium",
            description: `Carrier webhook ${b.event_id} reports ${delta} additional delay days. Downstream order impact requires review.`,
            shipmentId: s.id, affectedSkus: [], // filled from shipment lines in step 2
          },
        });
        await notify(tx, `Carrier update: ${s.id} moved by ${delta} day(s).`, "warning");
      }
      await audit(tx, actor, "CARRIER_EVENT_ACCEPTED", s.id, `Event ${b.event_id}; ETA ${b.eta}; delay delta ${delta} day(s).`);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return duplicate;
    throw e;
  }
  return { ok: true, duplicate: false, deltaDays: delta };
});
