"use client";
// Operations Analyst home (and the Administrator's read-only overview).
import { useEffect, useState } from "react";
import { can } from "@/lib/roles";
import { api, useData, useLive } from "../live";
import { NetworkMap } from "../NetworkMap";
import { OptionFacts } from "../PlanDetails";
import type { AffectedOrder, DisruptionDetail, Overview, RecoveryOption } from "../types";
import { ago, day, dueIn, Empty, FactorBars, inr, Kpi, Modal, PageHead, Pill, RiskBadge, RoleGuide } from "../ui";

export function DisruptionsPage({ go }: { go: (path: string) => void }) {
  const { me } = useLive();
  const { data, error } = useData<Overview>("/api/overview");
  const analyst = can(me.role, "submit");
  if (error) return <Empty title="Couldn’t load the overview">{error}</Empty>;
  if (!data) return <div className="loading">Loading the network…</div>;
  const active = data.disruptions.filter((d) => d.status === "Active");
  const resolved = data.disruptions.filter((d) => d.status !== "Active");

  return (
    <>
      <RoleGuide role={me.role} />
      <PageHead title={analyst ? "Disruptions to handle" : "Network overview"} sub="Updates by itself whenever anyone acts or a carrier event arrives." />
      <div className="kpis five">
        <Kpi label="Active disruptions" value={data.kpis.activeDisruptions} tone={data.kpis.activeDisruptions ? "red" : ""} />
        <Kpi label="Orders at risk" value={data.kpis.ordersAtRisk} hint={`${data.kpis.unitsAtRisk.toLocaleString("en-IN")} units short`} tone={data.kpis.ordersAtRisk ? "amber" : ""} />
        <Kpi label="Penalty exposure" value={inr(data.kpis.exposureInr)} hint="if at-risk orders are late" />
        <Kpi label="Approved, waiting to run" value={data.kpis.ordersApproved} hint={`${data.kpis.plansAwaitingApproval} more awaiting approval`} tone="blue" />
        <Kpi label="Orders recovered" value={data.kpis.ordersRecovered} hint="executed recoveries" tone="green" />
      </div>
      <NetworkMap map={data.map} onPick={(id) => go(`disruptions/${id}`)} />

      <h2 className="section">Active disruptions</h2>
      {active.length === 0 && <Empty title="No active disruptions">Every affected order has a recovery in place.</Empty>}
      <div className="list">
        {active.map((d) => (
          <button key={d.id} className="card row-card" onClick={() => go(`disruptions/${d.id}`)}>
            <div className="row-main">
              <div className="row-title"><Pill>{d.severity}</Pill> <b>{d.title}</b></div>
              <div className="muted small">{d.id} · {d.typeLabel} · detected {ago(d.createdAt)}{d.supplier ? ` · supplier ${d.supplier.name}` : ""}</div>
            </div>
            <div className="row-stats">
              <span><b className="red-text">{d.atRisk}</b> at risk</span>
              <span><b>{d.approved}</b> approved</span>
              <span><b>{d.recovered}</b> recovered</span>
              <span><b>{inr(d.exposureInr)}</b> exposure</span>
              <span className="chev">{analyst ? "Handle →" : "View →"}</span>
            </div>
          </button>
        ))}
      </div>
      {resolved.length > 0 && (
        <>
          <h2 className="section">Resolved</h2>
          <div className="list">
            {resolved.map((d) => (
              <button key={d.id} className="card row-card dim" onClick={() => go(`disruptions/${d.id}`)}>
                <div className="row-main">
                  <div className="row-title"><Pill>{d.status}</Pill> <b>{d.title}</b></div>
                  <div className="muted small">{d.id} · {d.recovered} orders recovered</div>
                </div>
                <span className="chev">View →</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const SHOW = 12;

export function DisruptionPage({ id, go }: { id: string; go: (path: string) => void }) {
  const { me } = useLive();
  const { data, error } = useData<DisruptionDetail>(`/api/disruptions/${id}`);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [planning, setPlanning] = useState<AffectedOrder | null>(null);
  const analyst = can(me.role, "submit");
  if (error) return <Empty title="Couldn’t load this disruption">{error}</Empty>;
  if (!data) return <div className="loading">Loading…</div>;

  const atRisk = data.orders.filter((o) => o.status === "At risk").length;
  const done = data.orders.length - atRisk;
  const rows = all ? data.orders : data.orders.slice(0, SHOW);

  return (
    <>
      <button className="back" onClick={() => go("disruptions")}>← All disruptions</button>
      <section className="card hero">
        <div className="hero-top">
          <div>
            <div className="row-title"><Pill>{data.severity}</Pill> <Pill>{data.status}</Pill> <span className="muted small">{data.id} · {data.typeLabel} · detected {ago(data.createdAt)}</span></div>
            <h1>{data.title}</h1>
            <p>{data.description}</p>
          </div>
        </div>
        {data.shipment && (
          <div className="facts">
            <span><small>Shipment</small>{data.shipment.id} ({data.shipment.carrier})</span>
            <span><small>Status now</small>{data.shipment.status}</span>
            <span><small>New arrival</small>{data.shipment.eta ? day(data.shipment.eta) : "No date"}</span>
            <span><small>Supplier</small>{data.shipment.supplier.name}, {data.shipment.supplier.city} ({data.shipment.supplier.reliabilityPct}% on time)</span>
            <span><small>Destination</small>{data.shipment.warehouse.name}</span>
          </div>
        )}
        <div className="progress">
          <div className="progress-bar"><i style={{ width: `${data.orders.length ? (done / data.orders.length) * 100 : 100}%` }} /></div>
          <span>{done} of {data.orders.length} affected orders have a recovery in progress or done</span>
        </div>
      </section>

      <h2 className="section">
        Affected orders, riskiest first
        <span className="muted small"> · click a row to see why it scored that way</span>
      </h2>
      {data.orders.length === 0 ? (
        <Empty title="No orders affected">Free stock covers every order that relied on this shipment.</Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>Order</th><th>Deadline</th><th>Short</th><th>Risk</th><th>Exposure</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <OrderRow key={o.orderId} o={o} rank={i + 1} open={open === o.orderId} onToggle={() => setOpen(open === o.orderId ? null : o.orderId)}
                  onPlan={analyst && o.canPlan ? () => setPlanning(o) : undefined} />
              ))}
            </tbody>
          </table>
          {data.orders.length > SHOW && (
            <button className="btn ghost full" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${data.orders.length} orders`}</button>
          )}
        </div>
      )}
      {planning && <OptionsModal disruptionId={data.id} order={planning} onClose={() => setPlanning(null)} />}
    </>
  );
}

function OrderRow({ o, rank, open, onToggle, onPlan }: { o: AffectedOrder; rank: number; open: boolean; onToggle: () => void; onPlan?: () => void }) {
  return (
    <>
      <tr className={`clickable ${open ? "open" : ""}`} onClick={onToggle}>
        <td className="muted">{rank}</td>
        <td><b>{o.orderId}</b><div className="muted small">{o.customerId} <Pill>{o.tier}</Pill> {o.priority}</div></td>
        <td>{day(o.deadline)}<div className="muted small">{dueIn(o.deadline)}</div></td>
        <td>{o.unitsShort} units<div className="muted small">{o.lines.map((l) => l.productName).join(", ")}</div></td>
        <td><RiskBadge score={o.riskScore} level={o.riskLevel} /></td>
        <td>{inr(o.exposureInr)}<div className="muted small">{o.daysLate} day{o.daysLate === 1 ? "" : "s"} late</div></td>
        <td>
          {o.plan ? <><Pill>{o.plan.status}</Pill><div className="muted small">{o.plan.id} · {o.plan.kind}</div></> : <Pill>{o.status}</Pill>}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {onPlan && <button className="btn primary small" onClick={onPlan}>Find recovery</button>}
        </td>
      </tr>
      {open && (
        <tr className="expand">
          <td />
          <td colSpan={7}>
            <div className="expand-grid">
              <div>
                <h4>Why risk score {o.riskScore}</h4>
                <FactorBars factors={o.factors} />
              </div>
              <div>
                <h4>What is short</h4>
                <ul className="steps-list">
                  {o.lines.map((l) => (
                    <li key={l.productId}><b>{l.short}</b> of {l.needed} × {l.productName} ({l.productId}) at {inr(l.unitPrice)} each</li>
                  ))}
                </ul>
                <p className="muted small">Ships from {o.warehouse} to {o.deliveryCity}.</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function OptionsModal({ disruptionId, order, onClose }: { disruptionId: string; order: AffectedOrder; onClose: () => void }) {
  const { toast, bump } = useLive();
  const [options, setOptions] = useState<RecoveryOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ options: RecoveryOption[] }>(`/api/disruptions/${disruptionId}/options`, { orderId: order.orderId })
      .then((r) => {
        if (!alive) return;
        setOptions(r.options);
        setPick(r.options.find((o) => o.feasible)?.kind ?? null);
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [disruptionId, order.orderId]);

  const chosen = options?.find((o) => o.kind === pick);
  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await api<{ id: string; approverRole: string }>("/api/plans", { disruptionId, orderId: order.orderId, kind: chosen.kind });
      toast(`${r.id} sent to the ${r.approverRole} for approval.`);
      bump();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <Modal wide title={`Recovery options for ${order.orderId}`} onClose={onClose}
      footer={
        <>
          <span className="muted small">{chosen ? `Goes to the ${chosen.approverRole} for approval.` : "Choose an option."}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!chosen || busy} onClick={submit}>{busy ? "Sending…" : "Send for approval"}</button>
        </>
      }>
      <p className="muted">
        Built by the rules engine from live stock, supplier history and the {day(order.deadline)} deadline. Options that can’t work show the reason.
      </p>
      {loadError && <Empty title="Couldn’t build options">{loadError}</Empty>}
      {options === null && !loadError && <div className="loading">Checking stock and suppliers…</div>}
      <div className="options">
        {options?.map((o) => (
          <label key={o.kind} className={`option ${o.feasible ? "" : "disabled"} ${pick === o.kind ? "picked" : ""}`}>
            <input type="radio" name="opt" disabled={!o.feasible} checked={pick === o.kind} onChange={() => setPick(o.kind)} />
            <div>
              <div className="option-top"><b>{o.kind}</b>{o.feasible ? <span className="cost">{inr(o.costInr)}</span> : <Pill tone="grey">Not possible</Pill>}</div>
              <p>{o.feasible ? o.summary : o.reason}</p>
              {o.feasible && <OptionFacts o={o} />}
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
