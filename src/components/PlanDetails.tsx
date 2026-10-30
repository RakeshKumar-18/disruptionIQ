"use client";
// Plain-language description of what a plan does, and the card every role uses to look at a plan.
import { ago, day, dueIn, FactorBars, inr, Pill, RiskBadge } from "./ui";
import type { PlanView, RecoveryOption } from "./types";

type Transfer = { units: number; productName: string; fromWarehouseName: string; transferDays: number };
type Unit = { units: number; productName: string };
type Purchase = Unit & { supplierName: string; city: string; reliabilityPct: number; leadTimeDays: number };

export function WhatItDoes({ kind, details }: { kind: string; details: Record<string, unknown> }) {
  if (kind === "Reallocate stock") {
    const t = (details.transfers as Transfer[]) ?? [];
    return (
      <ul className="steps-list">
        {t.map((x, i) => (
          <li key={i}>Move <b>{x.units}</b> × {x.productName} from <b>{x.fromWarehouseName}</b> to {String(details.toWarehouseName ?? "the order’s warehouse")} ({x.transferDays}-day transfer)</li>
        ))}
      </ul>
    );
  }
  if (kind === "Split order") {
    const now = (details.shipNow as Unit[]) ?? [], later = (details.later as Unit[]) ?? [];
    return (
      <ul className="steps-list">
        {now.map((x, i) => <li key={`n${i}`}>Ship <b>{x.units}</b> × {x.productName} now, on time</li>)}
        {later.map((x, i) => <li key={`l${i}`}>Send the remaining <b>{x.units}</b> × {x.productName} when stock arrives</li>)}
      </ul>
    );
  }
  if (kind === "Expedite shipment") {
    return (
      <ul className="steps-list">
        <li>Upgrade shipment <b>{String(details.shipmentId)}</b> to priority freight: <b>{String(details.daysRecovered)} days</b> sooner{details.newEta ? `, arriving ${day(String(details.newEta))}` : ""}</li>
      </ul>
    );
  }
  if (kind === "Alternative supplier") {
    const p = (details.purchases as Purchase[]) ?? [];
    return (
      <ul className="steps-list">
        {p.map((x, i) => (
          <li key={i}>Buy <b>{x.units}</b> × {x.productName} from <b>{x.supplierName}</b> ({x.city}): {x.reliabilityPct}% on time, {x.leadTimeDays}-day lead time</li>
        ))}
      </ul>
    );
  }
  return null;
}

export function OptionFacts({ o }: { o: RecoveryOption }) {
  return (
    <div className="facts">
      <span><small>Cost</small>{inr(o.costInr)}</span>
      <span><small>Ready by</small>{o.readyBy ? day(o.readyBy) : "—"}</span>
      <span><small>Saves the order</small>{o.saves}</span>
      <span><small>Approved by</small>{o.approverRole}</span>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  "Pending approval": "Waiting for approval",
  "Changes proposed": "Approver proposed a change",
  Approved: "Approved, waiting for the warehouse",
  Executed: "Done",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
  Blocked: "Blocked at execution",
};

export function PlanCard({ p, children, showRisk = true }: { p: PlanView; children?: React.ReactNode; showRisk?: boolean }) {
  return (
    <article className="card plan">
      <header className="plan-head">
        <div>
          <div className="plan-title">
            <b>{p.kind}</b> for order <b>{p.order.id}</b>
          </div>
          <div className="muted small">
            {p.id} · requested by {p.createdBy} {ago(p.createdAt)} · {p.disruption.id}: {p.disruption.title}
          </div>
        </div>
        <div className="plan-head-right">
          <Pill>{p.status}</Pill>
          <div className="plan-cost">{inr(p.costInr)}</div>
        </div>
      </header>

      <div className="plan-grid">
        <div>
          <h4>What this plan does</h4>
          <WhatItDoes kind={p.kind} details={p.details} />
          <div className="facts">
            <span><small>Customer</small>{p.order.customerId} <Pill>{p.order.tier}</Pill></span>
            <span><small>Priority</small>{p.order.priority}</span>
            <span><small>Deadline</small>{day(p.order.deadline)} ({dueIn(p.order.deadline)})</span>
            <span><small>Warehouse</small>{p.order.warehouse}</span>
          </div>
          {p.note && <p className={`note ${p.status === "Blocked" ? "bad" : ""}`}><b>{p.status === "Rejected" ? "Reason:" : p.status === "Blocked" ? "Why it was blocked:" : "Note:"}</b> {p.note}</p>}
          {p.liveCheck && (
            <p className={`check ${p.liveCheck === "OK" ? "good" : "bad"}`}>
              {p.liveCheck === "OK" ? "✓ Live check passed: the stock and shipments needed are still available." : `✗ Live check failed: ${p.liveCheck}`}
            </p>
          )}
        </div>
        {showRisk && p.risk && (
          <div>
            <h4>
              Why this order matters <RiskBadge score={p.risk.score} level={p.risk.level} />
            </h4>
            <FactorBars factors={p.risk.factors} />
          </div>
        )}
      </div>

      <footer className="plan-foot">
        <span className="muted small">
          {STATUS_TEXT[p.status] ?? p.status}
          {p.reviewedBy && ` · reviewed by ${p.reviewedBy}`}
          {p.executedBy && ` · executed by ${p.executedBy} ${ago(p.executedAt)}`}
        </span>
        {children && <div className="actions">{children}</div>}
      </footer>
    </article>
  );
}
