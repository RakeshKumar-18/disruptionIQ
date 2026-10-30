"use client";
import { useEffect, useState } from "react";
import { ROLES, type RoleName } from "@/lib/roles";
import type { Factor } from "./types";

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "No date");
export const dateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function ago(s: string | null) {
  if (!s) return "—";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(s)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function dueIn(s: string) {
  const d = Math.floor((Date.parse(s) - Date.now()) / 86_400_000);
  return d <= 0 ? "due today" : `due in ${d} day${d === 1 ? "" : "s"}`;
}

const TONE: Record<string, string> = {
  Critical: "red", High: "amber", Medium: "violet", Low: "grey",
  Active: "red", Monitoring: "grey", Resolved: "green",
  "At risk": "red", Recovering: "amber", Recovered: "green",
  "Pending approval": "amber", "Changes proposed": "violet", Approved: "blue", Executed: "green",
  Rejected: "grey", Withdrawn: "grey", Blocked: "red",
  Premium: "gold", Standard: "grey",
  APPLIED: "green", DUPLICATE: "violet", STALE: "amber", CONFLICT: "amber",
};

export function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const t = tone ?? TONE[String(children)] ?? "grey";
  return <span className={`pill ${t}`}>{children}</span>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function FactorBars({ factors }: { factors: Factor[] }) {
  return (
    <div className="factors">
      {factors.map((f) => (
        <div className="factor" key={f.key}>
          <div className="factor-top">
            <span>{f.label}</span>
            <b>
              {f.points}<small>/{f.max}</small>
            </b>
          </div>
          <div className="bar"><i style={{ width: `${(f.points / f.max) * 100}%` }} /></div>
          <div className="factor-detail">{f.detail}</div>
        </div>
      ))}
    </div>
  );
}

export function RiskBadge({ score, level }: { score: number; level: string }) {
  return (
    <span className={`risk ${TONE[level] ?? "grey"}`} title={`Risk score ${score} of 100`}>
      <b>{score}</b> {level}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <b>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

// "What is my job here?" box at the top of each role's main screen. Can be folded away.
export function RoleGuide({ role }: { role: RoleName }) {
  const info = ROLES[role];
  const key = `diq-guide-${role}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "closed") setOpen(false);
    } catch {
      // storage blocked: keep it open
    }
  }, [key]);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? "closed" : "open");
    } catch {
      // ignore
    }
  };
  return (
    <section className={`guide ${open ? "" : "folded"}`}>
      <div className="guide-head">
        <div>
          <div className="eyebrow">Your role: {role}</div>
          <p className="guide-line">{info.oneLine}</p>
        </div>
        <button className="btn small ghost" onClick={toggle}>{open ? "Hide steps" : "Show steps"}</button>
      </div>
      {open && (
        <>
          <ol className="guide-steps">
            {info.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="guide-cannot">{info.cannot}</p>
        </>
      )}
    </section>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
