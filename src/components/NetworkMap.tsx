"use client";
// Live network map, redrawn from the database on every refresh.
// Each city shows its state, a risk signal and units: at risk → approved (waiting to run) → recovered,
// so an approval or an execution changes the map within seconds on every screen.
import { useState } from "react";
import { CITIES } from "@/lib/geo";
import type { MapData, MapLocation, SignalLevel } from "./types";
import { inr, Pill } from "./ui";

const W = 560, H = 540;
const xy = (city: string): [number, number] => {
  const c = CITIES[city] ?? { lon: 79, lat: 20 };
  return [10 + ((c.lon - 68.5) / 22.5) * (W - 20), 10 + ((30 - c.lat) / 21.5) * (H - 20)];
};
// Which side each city's label goes on, so close cities don't overlap.
const SIDE: Record<string, "left" | "right" | "below"> = {
  Mumbai: "left", Ahmedabad: "left", Kochi: "left", Jaipur: "left", Bengaluru: "left", Kolkata: "left", Pune: "below", Hyderabad: "below",
};

export const SIGNAL_TONE: Record<SignalLevel, string> = { Critical: "red", High: "amber", Medium: "violet", Recovering: "blue", Normal: "green" };
const n = (x: number) => x.toLocaleString("en-IN");

function unitsLine(l: MapLocation): { text: string; cls: string } | null {
  if (l.units.atRisk > 0) return { text: `${n(l.units.atRisk)} units at risk`, cls: "u-risk" };
  if (l.units.approved > 0) return { text: `${n(l.units.approved)} units approved`, cls: "u-approved" };
  if (l.units.recovered > 0) return { text: `${n(l.units.recovered)} units recovered`, cls: "u-recovered" };
  return null;
}

export function NetworkMap({ map, onPick }: { map: MapData; onPick?: (disruptionId: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const picked = map.locations.find((l) => l.city === sel);
  const watch = map.locations.filter((l) => l.signal.level !== "Normal").slice(0, 4);

  return (
    <>
      <div className="map-card">
        <div className="map-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label="Network map of India: warehouses, suppliers and risk signals">
            <defs>
              <pattern id="grid" width="27" height="27" patternUnits="userSpaceOnUse">
                <path d="M27 0H0V27" fill="none" stroke="var(--grid)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#grid)" rx="10" />
            {map.routes.map((r, i) => {
              const [x1, y1] = xy(r.from), [x2, y2] = xy(r.to);
              if (x1 === x2 && y1 === y2) return null;
              const mx = (x1 + x2) / 2 + (y2 - y1) * 0.2, my = (y1 + y2) / 2 - (x2 - x1) * 0.2;
              return (
                <path key={`${r.disruptionId}-${r.to}-${i}`} d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`}
                  className={`route ${r.severity.toLowerCase()}`} onClick={() => onPick?.(r.disruptionId)}>
                  <title>{`${r.disruptionId}: ${r.label} (${r.from} → ${r.to})`}</title>
                </path>
              );
            })}
            {map.locations.map((l) => {
              const [x, y] = xy(l.city);
              const r = l.warehouses.length ? 7 + Math.min(5, l.warehouses.length * 2) : 5;
              const side = SIDE[l.city] ?? "right";
              const tx = side === "left" ? -(r + 6) : side === "right" ? r + 6 : 0;
              const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
              const dy = side === "below" ? r + 14 : 0;
              const u = unitsLine(l);
              const lvl = l.signal.level.toLowerCase();
              return (
                <g key={l.city} className={`city lvl-${lvl} ${sel === l.city ? "selected" : ""} ${l.warehouses.length ? "" : "supplier-only"}`}
                  transform={`translate(${x} ${y})`} onClick={() => setSel(sel === l.city ? null : l.city)} tabIndex={0} role="button"
                  aria-label={`${l.city}, ${l.state}: ${l.signal.level}. ${l.signal.reason}`}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(sel === l.city ? null : l.city)}>
                  {(l.signal.level === "Critical" || l.signal.level === "High") && <circle r={r + 5} className="pulse-ring" />}
                  {l.suppliersDown > 0 && <rect x={-r - 4} y={-r - 4} width="8" height="8" className="supplier-node" transform={`rotate(45 ${-r - 0} ${-r - 0})`} />}
                  <circle r={r} className="core" />
                  <text x={tx} y={dy - 3} textAnchor={anchor} className="c-name">{l.city}</text>
                  <text x={tx} y={dy + 9} textAnchor={anchor} className="c-state">{l.state}</text>
                  {u && <text x={tx} y={dy + 21} textAnchor={anchor} className={`c-units ${u.cls}`}>{u.text}</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="map-side">
          <div className="map-summary">
            <b>{map.summary.cities} cities · {map.summary.states} states</b>
            <span className="muted small">{map.summary.warehouses} warehouses · {map.summary.suppliers} suppliers</span>
          </div>
          <div className="legend">
            <span><i className="dot lvl-critical" /> Critical risk</span>
            <span><i className="dot lvl-high" /> High risk</span>
            <span><i className="dot lvl-medium" /> Medium risk</span>
            <span><i className="dot lvl-recovering" /> Recovery approved / under way</span>
            <span><i className="dot lvl-normal" /> Normal</span>
            <span><i className="diamond" /> Supplier shut down</span>
          </div>
          {picked ? (
            <LocationDetail l={picked} onPick={onPick} onClose={() => setSel(null)} />
          ) : (
            <div className="map-detail">
              <b>Risk signals now</b>
              {watch.length === 0 && <span className="muted small">No location has orders at risk.</span>}
              {watch.map((l) => (
                <button key={l.city} className="signal-row" onClick={() => setSel(l.city)}>
                  <Pill tone={SIGNAL_TONE[l.signal.level]}>{l.signal.level}</Pill>
                  <span><b>{l.city}</b> <span className="muted small">{l.state}</span><br /><span className="small">{l.signal.reason}</span></span>
                </button>
              ))}
              <span className="muted small">Click a city for its warehouses, stock and inbound shipments.</span>
            </div>
          )}
        </div>
      </div>

      <div className="card table-card locations">
        <table className="table">
          <thead>
            <tr>
              <th>Location</th><th>Risk signal</th><th>At risk</th><th>Approved, waiting</th><th>Recovered</th>
              <th>Free stock</th><th>Inbound delayed</th><th>Suppliers</th>
            </tr>
          </thead>
          <tbody>
            {map.locations.map((l) => (
              <tr key={l.city} className={`clickable ${sel === l.city ? "open" : ""}`} onClick={() => setSel(l.city)}>
                <td><b>{l.city}</b><div className="muted small">{l.state}</div></td>
                <td><Pill tone={SIGNAL_TONE[l.signal.level]}>{l.signal.level}</Pill><div className="muted small">{l.signal.reason}</div></td>
                <td>{l.orders.atRisk ? <><b className="red-text">{l.orders.atRisk}</b> orders<div className="muted small">{n(l.units.atRisk)} units</div></> : "—"}</td>
                <td>{l.orders.approved ? <><b>{l.orders.approved}</b> orders<div className="muted small">{n(l.units.approved)} units</div></> : "—"}</td>
                <td>{l.orders.recovered ? <><b>{l.orders.recovered}</b> orders<div className="muted small">{n(l.units.recovered)} units</div></> : "—"}</td>
                <td>{l.warehouses.length ? n(l.stock.free) : <span className="muted small">no warehouse</span>}</td>
                <td>{l.inbound.open ? `${n(l.inbound.delayed)} of ${n(l.inbound.open)}` : "—"}</td>
                <td>{l.suppliers}{l.suppliersDown ? <span className="red-text small"> ({l.suppliersDown} shut)</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LocationDetail({ l, onPick, onClose }: { l: MapLocation; onPick?: (id: string) => void; onClose: () => void }) {
  return (
    <div className="map-detail">
      <div className="map-detail-head">
        <div><b>{l.city}</b> <span className="muted small">{l.state}</span></div>
        <button className="icon-btn small-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div><Pill tone={SIGNAL_TONE[l.signal.level]}>{l.signal.level}</Pill> <span className="small">{l.signal.reason}</span></div>
      <div className="mini-grid">
        <span><small>At risk</small>{n(l.units.atRisk)} units · {l.orders.atRisk} orders</span>
        <span><small>Approved, waiting</small>{n(l.units.approved)} units · {l.orders.approved} orders</span>
        <span><small>Recovered</small>{n(l.units.recovered)} units · {l.orders.recovered} orders</span>
        <span><small>Penalty exposure</small>{inr(l.exposureInr)}</span>
        <span><small>Inbound shipments</small>{n(l.inbound.open)} open, {n(l.inbound.delayed)} delayed or held</span>
        <span><small>Suppliers here</small>{l.suppliers}{l.suppliersDown ? `, ${l.suppliersDown} shut down` : ""}</span>
      </div>
      {l.warehouses.length > 0 ? (
        l.warehouses.map((w) => (
          <div key={w.id} className="map-row"><span>{w.name}</span><span>{n(w.free)} free / {n(w.onHand)}</span></div>
        ))
      ) : (
        <span className="muted small">Suppliers only, no warehouse here.</span>
      )}
      {l.disruptions.length > 0 && onPick && (
        <div className="map-links">
          {l.disruptions.map((id) => <button key={id} className="btn small" onClick={() => onPick(id)}>Open {id} →</button>)}
        </div>
      )}
    </div>
  );
}
