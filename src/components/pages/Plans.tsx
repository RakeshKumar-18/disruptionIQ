"use client";
// Plan screens for the analyst (My plans), approvers (Waiting for you, Your decisions) and the
// warehouse operator (Ready to execute, Executed by you). Each role only gets buttons it may use.
import { useState } from "react";
import { api, useData, useLive } from "../live";
import { OptionFacts, PlanCard, WhatItDoes } from "../PlanDetails";
import type { PlanView, RecoveryOption } from "../types";
import { Empty, inr, Modal, PageHead, Pill, RoleGuide } from "../ui";

function usePlans(view: string) {
  return useData<{ plans: PlanView[] }>(`/api/plans?view=${view}`);
}

function useAct() {
  const { toast, bump } = useLive();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (planId: string, action: string, body: object = {}, done?: string) => {
    setBusy(`${planId}:${action}`);
    try {
      const r = await api<{ ok: boolean; status: string; message?: string }>(`/api/plans/${planId}/${action}`, body);
      if (r.ok) toast(done ?? `${planId}: ${r.status}.`);
      else toast(`${planId} blocked: ${r.message}`, "error");
      bump();
    } catch (e) {
      toast((e as Error).message, "error");
      bump();
    } finally {
      setBusy(null);
    }
  };
  return { act, busy };
}

function Loading({ error }: { error: string | null }) {
  return error ? <Empty title="Couldn’t load">{error}</Empty> : <div className="loading">Loading…</div>;
}

// ---------------- Operations Analyst ----------------

export function MyPlansPage() {
  const { me } = useLive();
  const { data, error } = usePlans("mine");
  const { act, busy } = useAct();
  if (!data) return <Loading error={error} />;
  const needs = data.plans.filter((p) => ["Changes proposed", "Blocked"].includes(p.status));
  const going = data.plans.filter((p) => ["Pending approval", "Approved"].includes(p.status));
  const done = data.plans.filter((p) => ["Executed", "Rejected", "Withdrawn"].includes(p.status));
  return (
    <>
      <RoleGuide role={me.role} />
      <PageHead title="My plans" sub="Every recovery plan you sent, and where it is now." />
      <h2 className="section">Needs your action <Pill tone={needs.length ? "red" : "grey"}>{needs.length}</Pill></h2>
      {needs.length === 0 && <Empty title="Nothing needs you right now" />}
      <div className="list">
        {needs.map((p) => (
          <PlanCard key={p.id} p={p} showRisk={false}>
            {p.status === "Changes proposed" && p.proposed && (
              <div className="proposal">
                <div><b>{p.reviewedBy} proposes instead:</b> {p.proposed.kind}</div>
                <WhatItDoes kind={p.proposed.kind} details={p.proposed.details} />
                <OptionFacts o={p.proposed} />
                <div className="actions">
                  <button className="btn" disabled={!!busy} onClick={() => act(p.id, "withdraw", {}, `${p.id} withdrawn.`)}>Withdraw plan</button>
                  <button className="btn primary" disabled={!!busy} onClick={() => act(p.id, "accept", {}, `${p.id}: change accepted and approved.`)}>Accept change</button>
                </div>
              </div>
            )}
            {p.status === "Blocked" && (
              <>
                <span className="muted small">Withdraw it, then pick another option from the disruption.</span>
                <button className="btn" disabled={!!busy} onClick={() => act(p.id, "withdraw", {}, `${p.id} withdrawn.`)}>Withdraw plan</button>
              </>
            )}
          </PlanCard>
        ))}
      </div>
      <h2 className="section">In progress <Pill tone="grey">{going.length}</Pill></h2>
      {going.length === 0 && <Empty title="No plans in progress" />}
      <div className="list">
        {going.map((p) => (
          <PlanCard key={p.id} p={p} showRisk={false}>
            {p.status === "Pending approval" && (
              <button className="btn" disabled={!!busy} onClick={() => act(p.id, "withdraw", {}, `${p.id} withdrawn.`)}>Withdraw</button>
            )}
          </PlanCard>
        ))}
      </div>
      {done.length > 0 && (
        <>
          <h2 className="section">Finished <Pill tone="grey">{done.length}</Pill></h2>
          <div className="list">{done.map((p) => <PlanCard key={p.id} p={p} showRisk={false} />)}</div>
        </>
      )}
    </>
  );
}

// ---------------- Supply Chain Manager / Procurement Approver ----------------

export function ReviewPage() {
  const { me } = useLive();
  const { data, error } = usePlans("review");
  const { act, busy } = useAct();
  const [rejecting, setRejecting] = useState<PlanView | null>(null);
  const [proposing, setProposing] = useState<PlanView | null>(null);
  if (!data) return <Loading error={error} />;
  const kinds =
    me.role === "Supply Chain Manager" ? "stock plans (reallocate stock, split order)"
      : me.role === "Procurement Approver" ? "spending plans (expedite shipment, alternative supplier)"
        : "stock and spending plans sent by other roles (never your own)";
  return (
    <>
      <RoleGuide role={me.role} />
      <PageHead title="Waiting for your decision" sub={`Only ${kinds} come to you. Oldest first.`} />
      {data.plans.length === 0 && <Empty title="Nothing waiting for you">New plans appear here automatically as analysts send them.</Empty>}
      <div className="list">
        {data.plans.map((p) => (
          <PlanCard key={p.id} p={p}>
            <button className="btn danger" disabled={!!busy} onClick={() => setRejecting(p)}>Reject</button>
            <button className="btn" disabled={!!busy} onClick={() => setProposing(p)}>Propose a change</button>
            {p.liveCheck === "OK" ? (
              <button className="btn primary" disabled={!!busy} onClick={() => act(p.id, "approve", {}, `${p.id} approved. The warehouse can now execute it.`)}>
                Approve {inr(p.costInr)}
              </button>
            ) : (
              <span className="muted small">Can’t approve while the live check fails.</span>
            )}
          </PlanCard>
        ))}
      </div>
      {rejecting && <RejectModal plan={rejecting} onClose={() => setRejecting(null)} onReject={(reason) => act(rejecting.id, "reject", { reason }, `${rejecting.id} rejected.`).then(() => setRejecting(null))} />}
      {proposing && <ProposeModal plan={proposing} onClose={() => setProposing(null)} onPropose={(kind, note) => act(proposing.id, "propose", { kind, note }, `Change proposed. ${proposing.createdBy} must accept it.`).then(() => setProposing(null))} />}
    </>
  );
}

function RejectModal({ plan, onClose, onReject }: { plan: PlanView; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Reject ${plan.id}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={reason.trim().length < 3} onClick={() => onReject(reason.trim())}>Reject plan</button></>}>
      <p className="muted">{plan.createdBy} will see your reason and can send a different plan.</p>
      <label className="field">Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Too expensive for a Standard customer; try splitting the order" autoFocus />
      </label>
    </Modal>
  );
}

function ProposeModal({ plan, onClose, onPropose }: { plan: PlanView; onClose: () => void; onPropose: (kind: string, note: string) => void }) {
  const { data, error } = useData<{ options: RecoveryOption[] }>(`/api/plans/${plan.id}/alternatives`);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const feasible = data?.options.filter((o) => o.feasible) ?? [];
  return (
    <Modal wide title={`Propose a change to ${plan.id}`} onClose={onClose}
      footer={<><span className="muted small">{plan.createdBy} must accept it before it goes ahead.</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!pick} onClick={() => pick && onPropose(pick, note.trim())}>Send proposal</button></>}>
      <p className="muted">You can propose another option that you approve yourself. It is checked against live data again.</p>
      {!data && <Loading error={error} />}
      {data && data.options.length === 0 && <Empty title="No other options of your type">Approve or reject this plan instead.</Empty>}
      <div className="options">
        {data?.options.map((o) => (
          <label key={o.kind} className={`option ${o.feasible ? "" : "disabled"} ${pick === o.kind ? "picked" : ""}`}>
            <input type="radio" name="alt" disabled={!o.feasible} checked={pick === o.kind} onChange={() => setPick(o.kind)} />
            <div>
              <div className="option-top"><b>{o.kind}</b>{o.feasible ? <span className="cost">{inr(o.costInr)}</span> : <Pill tone="grey">Not possible</Pill>}</div>
              <p>{o.feasible ? o.summary : o.reason}</p>
              {o.feasible && <OptionFacts o={o} />}
            </div>
          </label>
        ))}
      </div>
      {feasible.length > 0 && (
        <label className="field">Note for {plan.createdBy} (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cheaper and still on time" />
        </label>
      )}
    </Modal>
  );
}

export function DecisionsPage() {
  const { data, error } = usePlans("reviewed");
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHead title="Your decisions" sub="Plans you approved, rejected or changed, newest first." />
      {data.plans.length === 0 && <Empty title="No decisions yet" />}
      <div className="list">{data.plans.map((p) => <PlanCard key={p.id} p={p} showRisk={false} />)}</div>
    </>
  );
}

// ---------------- Warehouse Operator ----------------

export function ExecutePage() {
  const { me } = useLive();
  const { data, error } = usePlans("execute");
  const { act, busy } = useAct();
  const [confirm, setConfirm] = useState<PlanView | null>(null);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <RoleGuide role={me.role} />
      <PageHead title="Ready to execute" sub="Approved plans, oldest first. Stock is rechecked live for each one." />
      {data.plans.length === 0 && <Empty title="Nothing to execute">Approved plans appear here automatically.</Empty>}
      <div className="list">
        {data.plans.map((p) => (
          <PlanCard key={p.id} p={p} showRisk={false}>
            {p.liveCheck === "OK" ? (
              <button className="btn primary" disabled={!!busy} onClick={() => setConfirm(p)}>Execute</button>
            ) : (
              <button className="btn danger" disabled={!!busy} onClick={() => act(p.id, "execute")}>Block and return to analyst</button>
            )}
          </PlanCard>
        ))}
      </div>
      {confirm && (
        <Modal title={`Execute ${confirm.id}?`} onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn primary" onClick={() => { act(confirm.id, "execute", {}, `${confirm.id} executed.`); setConfirm(null); }}>Yes, execute</button></>}>
          <WhatItDoes kind={confirm.kind} details={confirm.details} />
          <p className="muted">Stock is checked once more at the moment you confirm. This is a simulation: stock and shipments change in this app only, and no outside system is contacted.</p>
        </Modal>
      )}
    </>
  );
}

export function ExecutedPage() {
  const { data, error } = usePlans("executed");
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHead title="Executed by you" sub="Plans you carried out, newest first." />
      {data.plans.length === 0 && <Empty title="Nothing executed yet" />}
      <div className="list">{data.plans.map((p) => <PlanCard key={p.id} p={p} showRisk={false} />)}</div>
    </>
  );
}
