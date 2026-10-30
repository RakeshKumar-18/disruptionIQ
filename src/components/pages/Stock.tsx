"use client";
import { useState } from "react";
import { useData } from "../live";
import { dateTime, Empty, PageHead, Pager, Pill } from "../ui";

type StockRow = {
  warehouse: string; warehouseId: string; productId: string; product: string; criticality: string;
  onHand: number; reserved: number; free: number; inbound: number; reorderLevel: number; low: boolean; updatedAt: string;
};
type StockData = { total: number; page: number; pages: number; rows: StockRow[]; warehouses: { id: string; name: string }[] };

export function StockPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(1);
  const url = `/api/stock?q=${encodeURIComponent(query)}&warehouse=${warehouse}&page=${page}`;
  const { data, error } = useData<StockData>(url);
  return (
    <>
      <PageHead title="Stock lookup" sub="Free = on hand minus reserved. Updates live as plans are executed and deliveries arrive." />
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(q); setPage(1); }}>
        <input className="input" placeholder="Product ID or name, e.g. PRD00114" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(1); }}>
          <option value="">All warehouses</option>
          {data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button className="btn">Search</button>
      </form>
      {error && <Empty title="Couldn’t load stock">{error}</Empty>}
      {data && (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Warehouse</th><th>Product</th><th>On hand</th><th>Reserved</th><th>Free</th><th>Inbound</th><th>Reorder at</th><th>Updated</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.warehouseId}-${r.productId}`}>
                  <td>{r.warehouse}</td>
                  <td><b>{r.productId}</b><div className="muted small">{r.product} · {r.criticality}</div></td>
                  <td>{r.onHand}</td><td>{r.reserved}</td>
                  <td>{r.free} {r.low && <Pill tone="amber">Low</Pill>}</td>
                  <td>{r.inbound}</td><td>{r.reorderLevel}</td>
                  <td className="muted small">{dateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <Empty title="No matching stock" />}
          <div className="table-foot"><span className="muted small">{data.total.toLocaleString("en-IN")} rows</span><Pager page={data.page} pages={data.pages} onPage={setPage} /></div>
        </div>
      )}
    </>
  );
}
