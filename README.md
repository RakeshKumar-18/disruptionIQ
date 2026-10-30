# DisruptionIQ

From delivery delays to recovery plans. Logistics control tower built for Overclock'26.

A carrier event arrives (port congestion, customs hold, supplier shutdown…). DisruptionIQ works out
which customer orders it puts at risk, ranks them with a score that explains itself, builds recovery
options checked against live stock, and moves each plan through approval and simulated execution,
with every step in an audit trail. Every screen updates by itself within seconds.

## Who does what

| Role | Screens | Their job | Can't |
|---|---|---|---|
| Operations Analyst | Disruptions, My plans | Opens a disruption, checks the at-risk orders, picks a recovery option for each, sends it for approval | Approve or execute |
| Supply Chain Manager | Waiting for you, Your decisions | Approves **stock** plans: reallocate stock, split order | Review own plans, or spending plans |
| Procurement Approver | Waiting for you, Your decisions | Approves **spending** plans: expedite shipment, alternative supplier | Review own plans, or stock plans |
| Warehouse Operator | Ready to execute, Executed by you, Stock lookup | Executes approved plans after a live stock recheck (simulated) | Create or approve plans |
| Administrator | **Everything**, grouped as Operations, Approvals, Warehouse, System | Full access: can do every role's job, plus the simulator, event log, audit trail, import and demo reset | Approve a plan it sent itself |

Demo accounts are named by role only. Each role only sees the screens for its own job, with
step-by-step instructions at the top. Every permission is also enforced on the server
(`src/lib/roles.ts` is the single source). Separation of duties applies to everyone, including the
Administrator: a plan's requester can never approve it, and it never appears in their own approval queue.

**Plan workflow:** Analyst submits → the right approver approves, rejects (with a reason) or proposes
another option → if a change is proposed, the analyst must accept it → Warehouse Operator executes →
stock and the disruption update. A plan that live data no longer allows can't be approved or executed;
at execution it is blocked and returned to the analyst with the reason.

## Run it locally

You need Node.js 20+. **Windows:** keep the project in a short path such as `C:\dev\disruptionIQ`
(Postgres's tools fail on very long paths).

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run db:local              # starts Postgres on port 54329; leave this terminal open
```

In a second terminal:

```bash
npx prisma migrate deploy     # creates the tables
npm run db:import             # loads data/*.csv (about 1 minute; replaces everything)
npm run dev                   # http://localhost:3000
```

Demo PINs: Operations Analyst 1111 · Supply Chain Manager 2222 · Procurement Approver 4444 ·
Warehouse Operator 3333 · Administrator 9999.

## 5-minute demo script

1. **Administrator → Simulator →** send *Port congestion* or *Supplier production shutdown*. A new disruption appears on every screen.
2. **Operations Analyst →** open it. Orders are ranked by risk; click one to see the 5 factors. *Find recovery* → pick an option → *Send for approval*.
3. **Supply Chain Manager** (stock plan) or **Procurement Approver** (spending plan) → approve. On the map, those units move from "at risk" to "approved". Or propose a change, which the analyst must accept.
4. **Warehouse Operator →** the plan is waiting with a live stock check → *Execute*. Stock moves; the units turn "recovered" and the location's risk signal drops.
5. **Administrator → Send duplicate** → the repeated event is ignored. Show the Event log and Audit trail.

## The network map

15 cities across 12 states (the dataset's warehouse and supplier locations), each labelled with its
state. Every location shows units **at risk → approved (waiting to run) → recovered**, free stock,
inbound shipments (and how many are delayed or held), and suppliers (and how many are shut down).
Lines run from a disrupted supplier to the warehouses whose orders it hits. A table below the map
lists every location.

Risk signal per location (`src/lib/views.ts`):
- **Critical:** an order there scores Critical, or ₹10 lakh+ penalty exposure
- **High:** 5+ orders at risk, ₹2 lakh+ exposure, or an order scoring High
- **Medium:** any order at risk
- **Recovering:** nothing left at risk, but recoveries are approved or under way
- **Normal:** nothing at risk

## How the rules work

All decisions about stock, deadlines and permissions are deterministic code in `src/lib/engine/`.

**Impact** (`impact.ts`), per warehouse and product on the delayed shipment:
1. Free stock (on hand − reserved) covers the earliest-due orders first.
2. Orders not covered were relying on the inbound shipment, in deadline order, up to its quantity.
3. Those orders are **at risk** if the shipment now arrives after their deadline, or has no arrival date
   (supplier shutdown, cold-chain quarantine).

**Risk score** (`risk.ts`), 0–100, every point explained:

| Factor | Max | Rule |
|---|---|---|
| Days of slack | 30 | due today 30 · 1 day 26 · 2 days 22 · 3 days 18 · 4–5 days 12 · 6–8 days 7 · later 3 |
| Size of shortage | 25 | share of the needed units that are short × 25 |
| Customer tier | 15 | Premium 8 / Standard 3, plus priority Critical 7 · High 5 · Normal 2 · Low 0 |
| Penalty exposure | 20 | 20 × (₹ exposure ÷ ₹2,00,000), capped at 20 |
| Supplier reliability | 10 | (100 − on-time %) ÷ 4, capped at 10 |

Level: 70+ Critical · 50+ High · 30+ Medium · else Low.

**Customers** (not in the dataset, derived on import): the top 20% by total order value are Premium.
Penalty if late: Premium 2% and Standard 1% of the late goods' value per day. With no arrival date,
days late = the supplier's average lead time.

**Recovery options** (`options.ts`), each feasible or shown as "not possible" with the reason:

| Option | Approved by | Feasible when | Cost rule |
|---|---|---|---|
| Reallocate stock | Supply Chain Manager | another active warehouse has enough free stock and the transfer arrives before the deadline (same city 1 day, same region 2, else 3) | ₹2,000 per transfer + 1% of goods value per transit day |
| Split order | Supply Chain Manager | some of the order is in free stock right now | ₹1,500 |
| Expedite shipment | Procurement Approver | the delay has a known arrival date and arriving up to 3 days sooner meets the deadline | ₹5,000 + 2% of the delayed goods value |
| Alternative supplier | Procurement Approver | an active supplier with ≥80% on-time record has shipped this product before and its lead time fits | 15% price premium |

The client only says which option it wants; the server rebuilds the options and stores its own numbers.

**Carrier events** (`events.ts`): duplicates are detected by `idempotency_key` (a unique database key,
so even simultaneous copies are processed once); events older than the last applied update are ignored
as stale; events for an already-delivered shipment are ignored as conflicting. All outcomes are logged.

**Execution** (`execute.ts`) rechecks live data first; stock moves use a guarded SQL update, so two
executions can never spend the same free stock.

## The dataset (`data/`)

Imported: suppliers, warehouses, products, inventory, orders, order items, shipments, shipment items,
and the 2,001 carrier events (queued for the simulator). All dates are shifted so the dataset's
"now" (30 Oct 2026, 10:00) becomes the import time.

Not imported, on purpose:
- `disruptions.csv`, `disruption_order_impact.csv`: the app detects disruptions and calculates impact
  itself. The provided impact links don't match the shipment and order data, and 3 disruptions point
  to regions with no warehouses.
- `recovery_options.csv`: options are built from live stock instead.
- `users_roles.csv`, `approval_queue.csv`, `audit_trail.csv`: 1–5 sample rows.
- `order_risk_training.csv`: for the separate ML experiment. Its labels come from a rule-based formula,
  so high accuracy on it isn't evidence of real-world performance.

## Send a carrier event

```bash
curl -X POST http://localhost:3000/api/webhook/carrier \
  -H "content-type: application/json" -H "x-webhook-secret: dev-webhook-secret" \
  -d '{"event_id":"EVT-1","idempotency_key":"carrier-SHP006518-1","event_type":"PORT_CONGESTION","shipment_id":"SHP006518","location":"Chennai Hub","delay_days":6}'
```

Event types: `SHIPMENT_DELAYED`, `ROUTE_CHANGED`, `CUSTOMS_HOLD`, `QUALITY_HOLD`, `WEATHER_DELAY`,
`PORT_CONGESTION`, `SUPPLIER_SHUTDOWN`, `COLD_CHAIN_ALERT`, `IN_TRANSIT`, `DELIVERED`.

## Deploy (Vercel + Neon)

1. Create a Neon project and copy its pooled connection string.
2. Import the GitHub repo into Vercel; add `DATABASE_URL` and `WEBHOOK_SECRET`. The `vercel-build`
   script creates the tables.
3. Load the data once from your laptop: put the Neon string in `.env`, then `npm run db:import`.
4. The demo reset route reads `data/*.csv` at runtime (bundled via `next.config.ts`). It can take close
   to a minute, so on Vercel's free plan it may hit the time limit; use `npm run db:import` instead.

## Project layout

```
data/                        the synthetic dataset (CSV)
prisma/schema.prisma         data model
prisma/import-dataset.ts     npm run db:import
src/lib/roles.ts             roles, permissions, who approves what
src/lib/engine/              rules engine: events, impact, risk, options, execute
src/lib/dataset.ts           CSV import, date shift, demo reset
src/lib/simulator.ts         picks dataset events for the Administrator's simulator
src/lib/views.ts             what each screen reads
src/app/api/**/route.ts      API (one file per endpoint)
src/components/              UI: App shell, live updates, network map, one file per role area
```

## Not built yet

- The AI layer (summaries and explanations of the options) and the full chaos button.
- Scenarios without a carrier event in the dataset: inventory shortage, demand spike, warehouse outage, fuel price surge.
- 4-digit demo PINs with no rate limit are for the demo only.
