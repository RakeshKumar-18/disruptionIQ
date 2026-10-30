"use client";
// App shell: sign-in, then a navigation that contains only the screens the signed-in role uses.
import { useCallback, useEffect, useState } from "react";
import { can, ROLE_ORDER, ROLES, type RoleName } from "@/lib/roles";
import { api, LiveProvider, useData, useLive } from "./live";
import { ImportPage, LogPage, SimulatorPage, UsersPage } from "./pages/Admin";
import { DisruptionPage, DisruptionsPage } from "./pages/Disruptions";
import { DecisionsPage, ExecutedPage, ExecutePage, MyPlansPage, ReviewPage } from "./pages/Plans";
import { StockPage } from "./pages/Stock";
import type { Badges, Me, Notification } from "./types";
import { ago, Pill } from "./ui";

type NavItem = { path: string; label: string; badge?: keyof Badges; group?: string };

// Each role gets only its own screens. The Administrator has full access, grouped by job.
const NAV: Record<RoleName, NavItem[]> = {
  "Operations Analyst": [
    { path: "disruptions", label: "Disruptions", badge: "disruptions" },
    { path: "my-plans", label: "My plans", badge: "myPlans" },
  ],
  "Supply Chain Manager": [
    { path: "review", label: "Waiting for you", badge: "review" },
    { path: "decisions", label: "Your decisions" },
  ],
  "Procurement Approver": [
    { path: "review", label: "Waiting for you", badge: "review" },
    { path: "decisions", label: "Your decisions" },
  ],
  "Warehouse Operator": [
    { path: "execute", label: "Ready to execute", badge: "execute" },
    { path: "executed", label: "Executed by you" },
    { path: "stock", label: "Stock lookup" },
  ],
  Administrator: [
    { group: "Operations", path: "disruptions", label: "Network & disruptions", badge: "disruptions" },
    { group: "Operations", path: "my-plans", label: "My plans", badge: "myPlans" },
    { group: "Approvals", path: "review", label: "Waiting for approval", badge: "review" },
    { group: "Approvals", path: "decisions", label: "Your decisions" },
    { group: "Warehouse", path: "execute", label: "Ready to execute", badge: "execute" },
    { group: "Warehouse", path: "executed", label: "Executed by you" },
    { group: "Warehouse", path: "stock", label: "Stock lookup" },
    { group: "System", path: "simulator", label: "Simulator" },
    { group: "System", path: "events", label: "Event log" },
    { group: "System", path: "audit", label: "Audit trail" },
    { group: "System", path: "import", label: "Import data" },
    { group: "System", path: "users", label: "Roles" },
  ],
};

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch(() => setMe({ user: null }));
  }, []);
  useEffect(() => {
    load();
    const out = () => setMe({ user: null });
    window.addEventListener("diq:signed-out", out);
    return () => window.removeEventListener("diq:signed-out", out);
  }, [load]);

  if (!me) return <div className="boot">Loading DisruptionIQ…</div>;
  if (!me.user) return <Login onDone={load} />;
  return (
    <LiveProvider key={me.user.id} me={me.user} initialBadges={me.badges ?? {}}>
      <Shell onSignOut={async () => { await api("/api/logout", {}); setMe({ user: null }); }} />
    </LiveProvider>
  );
}

function useHash(): [string, (p: string) => void] {
  const read = () => (typeof window === "undefined" ? "" : window.location.hash.replace(/^#\/?/, ""));
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (p: string) => {
    window.location.hash = `/${p}`;
    window.scrollTo(0, 0);
  };
  return [hash, go];
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { me, badges, lastSync } = useLive();
  const [hash, go] = useHash();
  const nav = NAV[me.role];
  const [first, second] = hash.split("/");
  const known = nav.some((n) => n.path === first) || (first === "disruptions" && can(me.role, "view_network"));
  const page = known ? first : nav[0].path;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const synced = Math.max(0, Math.round((Date.now() - lastSync) / 1000));

  let body: React.ReactNode;
  if (page === "disruptions" && second) body = <DisruptionPage id={second} go={go} />;
  else if (page === "disruptions") body = <DisruptionsPage go={go} />;
  else if (page === "my-plans") body = <MyPlansPage />;
  else if (page === "review") body = <ReviewPage />;
  else if (page === "decisions") body = <DecisionsPage />;
  else if (page === "execute") body = <ExecutePage />;
  else if (page === "executed") body = <ExecutedPage />;
  else if (page === "stock") body = <StockPage />;
  else if (page === "simulator") body = <SimulatorPage go={go} />;
  else if (page === "events") body = <LogPage key="events" kind="events" />;
  else if (page === "audit") body = <LogPage key="audit" kind="audit" />;
  else if (page === "import") body = <ImportPage />;
  else if (page === "users") body = <UsersPage />;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><span className="logo">D</span><div><b>DisruptionIQ</b><small>Control tower</small></div></div>
        <nav>
          {nav.map((n, i) => {
            const count = n.badge ? badges[n.badge] : undefined;
            const header = n.group && n.group !== nav[i - 1]?.group ? <div className="nav-group">{n.group}</div> : null;
            return (
              <div key={n.path} className="nav-item">
                {header}
                <button className={`nav ${page === n.path ? "active" : ""}`} onClick={() => go(n.path)}>
                  <span>{n.label}</span>
                  {count ? <span className="count">{count}</span> : null}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="spacer" />
        <div className="who">
          <div className="avatar">{me.role.slice(0, 1)}</div>
          <div><b>{me.role}</b><small>{me.role === "Administrator" ? "Full access" : "Signed in"}</small></div>
        </div>
        <button className="btn ghost full" onClick={onSignOut}>Switch role</button>
      </aside>
      <main className="main">
        <header className="top">
          <span className="live"><i className="pulse" /> Live · synced {synced < 5 ? "just now" : `${synced}s ago`}</span>
          <Bell />
        </header>
        <div className="content">{body}</div>
      </main>
    </div>
  );
}

function Bell() {
  const [open, setOpen] = useState(false);
  const { data } = useData<{ notifications: Notification[] }>("/api/notifications");
  const [seen, setSeen] = useState(0);
  const items = data?.notifications ?? [];
  const unread = items.filter((n) => n.id > seen).length;
  return (
    <div className="bell-wrap">
      <button className="btn ghost" onClick={() => { setOpen(!open); if (items[0]) setSeen(items[0].id); }}>
        Updates {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="bell">
          {items.length === 0 && <p className="muted small pad">No updates for you yet.</p>}
          {items.map((n) => (
            <div key={n.id} className={`bell-item ${n.severity}`}>
              <div>{n.message}</div>
              <small className="muted">{ago(n.at)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Demo accounts, one per role (named by role only).
const DEMO_ACCOUNTS: { id: string; role: RoleName; pin: string }[] = [
  { id: "u-analyst", role: "Operations Analyst", pin: "1111" },
  { id: "u-manager", role: "Supply Chain Manager", pin: "2222" },
  { id: "u-procurement", role: "Procurement Approver", pin: "4444" },
  { id: "u-warehouse", role: "Warehouse Operator", pin: "3333" },
  { id: "u-admin", role: "Administrator", pin: "9999" },
];

function Login({ onDone }: { onDone: () => void }) {
  const [pick, setPick] = useState(DEMO_ACCOUNTS[0]);
  const [pin, setPin] = useState(DEMO_ACCOUNTS[0].pin);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/login", { user: pick.id, pin });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  const ordered = ROLE_ORDER.map((r) => DEMO_ACCOUNTS.find((a) => a.role === r)!);
  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="brand"><span className="logo">D</span><div><b>DisruptionIQ</b><small>From delivery delays to recovery plans</small></div></div>
        <h1>Choose your role</h1>
        <p className="muted">Each role sees only its own job. The Administrator has full access.</p>
        <div className="accounts">
          {ordered.map((a) => (
            <button type="button" key={a.id} className={`account ${pick.id === a.id ? "picked" : ""}`} onClick={() => { setPick(a); setPin(a.pin); }}>
              <div className="account-top"><b>{a.role}</b>{a.role === "Administrator" && <Pill tone="gold">Full access</Pill>}</div>
              <span>{ROLES[a.role].oneLine}</span>
            </button>
          ))}
        </div>
        <label className="field">PIN
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        <p className="muted small">Demo PINs are filled in for you. Every action is checked on the server.</p>
        {err && <p className="error">{err}</p>}
        <button className="btn primary full" disabled={busy}>{busy ? "Signing in…" : `Sign in as ${pick.role}`}</button>
      </form>
    </div>
  );
}
