"use client";
// Administrator screens: simulator, event log, audit trail, import, users and roles.
import { useState } from "react";
import { PERMISSION_TEXT, ROLE_ORDER, ROLES } from "@/lib/roles";
import { api, useData, useLive } from "../live";
import type { LogRow, Paged } from "../types";
import { ago, dateTime, Empty, Modal, PageHead, Pager, Pill, RoleGuide } from "../ui";

type SimState = {
  scenarios: { type: string; label: string; waiting: number }[];
  lastSent: { eventId: string; type: string; shipmentId: string; idempotencyKey: string; sentAt: string } | null;
};
type SimResult = { outcome: string; message: string; disruptionId?: string; ordersAtRisk?: number; event: { eventId: string; shipmentId: string; location?: string; delayDays?: number; idempotencyKey?: string } };

export function SimulatorPage({ go }: { go: (path: string) => void }) {
  const { me, toast, bump } = useLive();
  const { data, error } = useData<SimState>("/api/simulator");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<SimResult[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const run = async (key: string, body: object) => {
    setBusy(key);
    try {
      const r = await api<SimResult>("/api/simulator", body);
      setResults((x) => [r, ...x].slice(0, 6));
      toast(r.message, r.outcome === "APPLIED" ? "ok" : "info");
      bump();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setConfirmReset(false);
    setBusy("reset");
    try {
      await api("/api/admin/reset", {});
      setResults([]);
      toast("Demo reset to its starting state.");
      bump();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <RoleGuide role={me.role} />
      <PageHead title="Simulator" sub="Sends a real carrier event from the dataset, exactly as a carrier’s webhook would. The rules engine reacts within seconds on every screen.">
        <button className="btn danger" disabled={!!busy} onClick={() => setConfirmReset(true)}>{busy === "reset" ? "Resetting… (up to a minute)" : "Reset demo"}</button>
      </PageHead>
      {error && <Empty title="Couldn’t load the simulator">{error}</Empty>}
      <h2 className="section">1. Send a disruption</h2>
      <div className="sim-grid">
        {data?.scenarios.map((s) => (
          <button key={s.type} className="card sim" disabled={!!busy} onClick={() => run(s.type, { action: "send", type: s.type })}>
            <b>{s.label}</b>
            <span className="muted small">{busy === s.type ? "Sending…" : `${s.waiting} dataset events left`}</span>
          </button>
        ))}
      </div>
      <h2 className="section">2. Prove it’s safe</h2>
      <div className="card pad">
        <p>
          Carriers often resend the same event. Press this to resend the last event with the <b>same idempotency key</b>. The app must ignore it and change nothing.
        </p>
        <button className="btn" disabled={!!busy || !data?.lastSent} onClick={() => run("dup", { action: "duplicate" })}>
          {data?.lastSent ? `Send duplicate of ${data.lastSent.eventId}` : "Send an event first"}
        </button>
      </div>
      {results.length > 0 && (
        <>
          <h2 className="section">Results</h2>
          <div className="list">
            {results.map((r, i) => (
              <div key={i} className="card pad result">
                <div className="row-title"><Pill>{r.outcome}</Pill> <b>{r.event.eventId}</b> <span className="muted small">shipment {r.event.shipmentId}{r.event.location ? ` · ${r.event.location}` : ""}</span></div>
                <p>{r.message}</p>
                {r.disruptionId && r.ordersAtRisk ? <button className="btn small" onClick={() => go(`disruptions/${r.disruptionId}`)}>Open {r.disruptionId} →</button> : null}
              </div>
            ))}
          </div>
        </>
      )}
      {confirmReset && (
        <Modal title="Reset the demo?" onClose={() => setConfirmReset(false)}
          footer={<><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn danger" onClick={reset}>Yes, reset</button></>}>
          <p>This clears every disruption, plan, event, notification and audit entry, reloads stock and shipments from the dataset, and starts the two opening scenarios again. Orders, customers and products stay. Everyone stays signed in.</p>
        </Modal>
      )}
    </>
  );
}

const OUTCOME: Record<string, string> = {
  EVENT_APPLIED: "APPLIED", DISRUPTION_DETECTED: "APPLIED", EVENT_DUPLICATE: "DUPLICATE", EVENT_STALE: "STALE", EVENT_CONFLICT: "CONFLICT",
};

export function LogPage({ kind }: { kind: "events" | "audit" }) {
  const [page, setPage] = useState(1);
  const { data, error } = useData<Paged<LogRow>>(`/api/admin/log?kind=${kind}&page=${page}`);
  return (
    <>
      <PageHead
        title={kind === "events" ? "Event log" : "Audit trail"}
        sub={kind === "events" ? "Every carrier event received and what the app did with it: applied, or safely ignored as a duplicate, stale or conflicting update." : "Every action by every person and by the system, newest first. Entries can’t be edited."}
      />
      {error && <Empty title="Couldn’t load the log">{error}</Empty>}
      {data && (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Detail</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{dateTime(r.at)}<div className="muted small">{ago(r.at)}</div></td>
                  <td>{r.actor}</td>
                  <td>{kind === "events" ? <Pill>{OUTCOME[r.action] ?? r.action}</Pill> : <code>{r.action}</code>}</td>
                  <td><code>{r.entity}</code></td>
                  <td className="wrap">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <Empty title="Nothing logged yet" />}
          <div className="table-foot"><span className="muted small">{data.total} entries</span><Pager page={data.page} pages={data.pages} onPage={setPage} /></div>
        </div>
      )}
    </>
  );
}

type ImportResult = { accepted: number; rejected: number; errors: { row: number; error: string }[]; outcomes: Record<string, number> };

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((x) => x !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  cur.push(field);
  if (cur.some((x) => x !== "")) rows.push(cur);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function ImportPage() {
  const { toast, bump } = useLive();
  const [type, setType] = useState<"inventory" | "carrier_events">("carrier_events");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setResult(null);
    try {
      const text = await f.text();
      let rows: Record<string, unknown>[];
      if (f.name.toLowerCase().endsWith(".json")) {
        const j = JSON.parse(text) as unknown;
        rows = Array.isArray(j) ? (j as Record<string, unknown>[]) : ((j as { rows?: Record<string, unknown>[] }).rows ?? []);
      } else rows = parseCsv(text);
      if (!rows.length) throw new Error("The file has no rows.");
      if (rows.length > 2000) throw new Error(`The file has ${rows.length} rows; import at most 2,000 at a time.`);
      const r = await api<ImportResult>("/api/import", { filename: f.name, type, rows });
      setResult(r);
      toast(`${r.accepted} rows accepted, ${r.rejected} rejected.`, r.rejected ? "info" : "ok");
      bump();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead title="Import data" sub="CSV or JSON, at most 2,000 rows per file. Each row is checked on its own: bad rows are listed, good rows are saved." />
      <div className="card pad">
        <label className="field">What are you importing?
          <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="carrier_events">Carrier events (same columns as carrier_webhook_events.csv)</option>
            <option value="inventory">Stock levels (same columns as inventory.csv)</option>
          </select>
        </label>
        <p className="muted small">
          {type === "carrier_events"
            ? "Columns: event_id, idempotency_key, event_type, shipment_id, event_timestamp, location, delay_days. Each row goes through the webhook pipeline, so duplicates, stale and conflicting events are handled exactly as if a carrier had sent them."
            : "Columns: warehouse_id, product_id, on_hand_qty, reserved_qty, inbound_qty. Replaces the stock level for that warehouse and product."}
        </p>
        <label className="btn primary file">{busy ? "Importing…" : "Choose file…"}
          <input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} hidden />
        </label>
      </div>
      {result && (
        <div className="card pad">
          <p><b>{result.accepted}</b> rows accepted, <b>{result.rejected}</b> rejected.
            {Object.keys(result.outcomes).length > 0 && <> Outcomes: {Object.entries(result.outcomes).map(([k, v]) => <span key={k}> <Pill>{k}</Pill> {v}</span>)}</>}
          </p>
          {result.errors.length > 0 && (
            <ul className="errors">{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>
          )}
        </div>
      )}
    </>
  );
}

export function UsersPage() {
  return (
    <>
      <PageHead title="Roles" sub="What each role does and what it is allowed to do. Every permission is checked on the server, not just hidden in the screen." />
      <div className="roles-grid">
        {ROLE_ORDER.map((r) => {
          const info = ROLES[r];
          return (
            <section key={r} className="card pad role-card">
              <h3>{r} {r === "Administrator" && <Pill tone="gold">Full access</Pill>}</h3>
              <p>{info.oneLine}</p>
              <div className="chips">
                {info.permissions.map((p) => <span key={p} className="chip">{PERMISSION_TEXT[p]}</span>)}
              </div>
              <ol className="guide-steps">{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              <p className="guide-cannot">{info.cannot}</p>
            </section>
          );
        })}
      </div>
    </>
  );
}
