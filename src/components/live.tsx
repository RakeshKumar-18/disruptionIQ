"use client";
// Data loading and live updates. Every screen polls /api/version (every 3 seconds while visible);
// when anything changed (anyone approved, executed, sent an event...), every open list reloads by itself.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Badges, Me } from "./types";

export class ApiFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && url !== "/api/login") window.dispatchEvent(new Event("diq:signed-out"));
    throw new ApiFail(r.status, (data as { error?: string }).error ?? `Request failed (${r.status})`);
  }
  return data as T;
}

type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
type Live = {
  me: NonNullable<Me["user"]>;
  version: number;
  badges: Badges;
  lastSync: number;
  bump: () => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
};

const LiveContext = createContext<Live | null>(null);
export const useLive = () => {
  const c = useContext(LiveContext);
  if (!c) throw new Error("useLive outside LiveProvider");
  return c;
};

export function LiveProvider({ me, initialBadges, children }: { me: Live["me"]; initialBadges: Badges; children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const [badges, setBadges] = useState<Badges>(initialBadges);
  const [lastSync, setLastSync] = useState(Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const serverV = useRef<number | null>(null);
  const lastPoll = useRef(0);

  const poll = useCallback(async () => {
    lastPoll.current = Date.now();
    try {
      const r = await api<{ v: number; badges: Badges }>("/api/version");
      setBadges(r.badges);
      setLastSync(Date.now());
      if (serverV.current !== null && r.v !== serverV.current) setVersion((v) => v + 1);
      serverV.current = r.v;
    } catch {
      // offline for a moment: try again on the next tick
    }
  }, []);

  // Every 3 s while the screen is visible; every 15 s in a background tab; and at once when the
  // tab comes back into view, so a screen is never left showing old data.
  useEffect(() => {
    poll();
    const t = setInterval(() => {
      const visible = document.visibilityState === "visible";
      if (visible || Date.now() - lastPoll.current > 15_000) poll();
    }, 3000);
    const onShow = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [poll]);

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    poll();
  }, [poll]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <LiveContext.Provider value={{ me, version, badges, lastSync, bump, toast }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </LiveContext.Provider>
  );
}

// Loads `url` and reloads it whenever anything changes on the server. Keeps showing the old
// data while reloading, so screens don't flicker.
export function useData<T>(url: string | null) {
  const { version } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api<T>(url)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [url, version, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1) };
}
