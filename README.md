# DisruptionIQ

From delivery delays to recovery plans. Logistics control tower built for Overclock'26.

**Status: step 1 done.** The browser prototype now runs on a real server and a Postgres database.
All data is shared between users and devices, and every permission is checked on the server.

## Run it locally

You need Node.js 20 or newer.

> **Windows:** keep the project in a short folder such as `C:\dev\disruptioniq`.
> Postgres's Windows tools fail when the full path is very long.

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run db:local              # starts Postgres on port 54329; leave this terminal open
```

In a second terminal:

```bash
npx prisma migrate deploy     # creates the tables
npm run db:seed               # loads the demo data (run again any time to reset the demo)
npm run dev                   # http://localhost:3000
```

### Demo accounts

| User | Role | PIN |
|---|---|---|
| Rakesh | Operations Analyst | 1111 |
| Varsha | Supply Chain Manager | 2222 |
| Tristan | Warehouse Operator | 3333 |
| Joshita | Procurement Approver | 4444 |
| Administrator | Administrator | 9999 |

## Send a carrier webhook

Real carriers send the shared secret from `.env`. The "Simulate webhook" button in the app uses
your signed-in session instead, and the audit log records who pressed it.

```bash
curl -X POST http://localhost:3000/api/webhook/carrier \
  -H "content-type: application/json" \
  -H "x-webhook-secret: dev-webhook-secret" \
  -d '{"event_id":"evt-001","shipment_id":"SHP-2042","eta":"2026-11-15T10:00:00Z","status":"Delayed"}'
```

Sending the same `event_id` again returns `"duplicate": true` and changes nothing.

## Deploy (Vercel + Neon)

1. Create a Neon project and copy its connection string.
2. Import the GitHub repo into Vercel. Add `DATABASE_URL` (the Neon string) and `WEBHOOK_SECRET` as environment variables.
3. Deploy. The `vercel-build` script creates the tables automatically.
4. Load the demo data once from your machine: set `DATABASE_URL` in `.env` to the Neon string, then run `npm run db:seed`.

## How it is organised

```
prisma/schema.prisma       data model (users, sessions, suppliers, warehouses, inventory,
                           shipments, orders, disruptions, plans, carrier events, audit, notifications)
prisma/seed.ts             demo data with dates relative to today
src/lib/rbac.ts            role -> permission table (the only place roles are defined)
src/lib/auth.ts            sign-in sessions (httpOnly cookie) and requirePermission()
src/app/api/**/route.ts    one file per API endpoint
public/index.html, app.js, app.css   the UI (the prototype's screens, now calling the API)
scripts/local-db.mjs       local Postgres for development
```

## What step 1 guarantees

- **Roles are enforced on the server.** Calling the API directly with the wrong role returns 403.
- **No self-approval.** The person who requested a plan cannot approve, reject or modify it.
- **Duplicate events are safe.** Six copies of one webhook sent at the same moment: one accepted, five ignored.
- **Double clicks are safe.** Two approvals of the same plan at the same moment: one succeeds, one gets 409.
- **Bad import rows are rejected one by one** with a reason, and good rows are still saved.
- **PINs are hashed**, and the data export never includes PINs or sessions.

## Known gaps (next steps)

- Which orders a disruption affects is still seeded by hand (`Disruption.affectedSkus`).
  Step 2 adds shipment lines so it can be calculated.
- Recovery options are still fixed templates and the risk score uses 3 factors. Steps 4–6 replace them.
- An approver can modify a plan and then approve their own edit. Step 3 closes this.
- An earlier ETA is always rejected as a conflict. Step 7 judges staleness by event time instead.
- Some dashboard captions ("2 scenarios live", "Scan complete · 2 risks") and the network map are still fixed text.
- Demo data uses $ and US cities; the pitch deck uses ₹.
- 4-digit PINs with no rate limit are fine for a demo, not for real use.
