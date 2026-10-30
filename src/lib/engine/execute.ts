// Carrying out an approved plan (simulated: only this app's data changes).
// Every plan is rechecked against live data first. Stock moves use a guarded SQL update,
// so two executions can never spend the same free stock.
import type { Plan } from "@prisma/client";
import type { Tx } from "../db";
import { DAY_MS, nextId } from "../records";

export class Blocked extends Error {}

type Transfer = { productId: string; productName: string; units: number; fromWarehouseId: string; fromWarehouseName: string };
type Unit = { productId: string; productName: string; units: number };
type Purchase = Unit & { supplierId: string; supplierName: string; leadTimeDays: number };

// Takes `units` of free stock (on hand minus reserved) or returns false if there isn't enough.
async function takeFree(tx: Tx, warehouseId: string, productId: string, units: number, reserve: boolean): Promise<boolean> {
  const n = reserve
    ? await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = "reserved" + ${units}, "updatedAt" = now()
        WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} AND "onHand" - "reserved" >= ${units}`
    : await tx.$executeRaw`UPDATE "Inventory" SET "onHand" = "onHand" - ${units}, "updatedAt" = now()
        WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} AND "onHand" - "reserved" >= ${units}`;
  return n === 1;
}

async function freeStock(tx: Tx, warehouseId: string, productId: string) {
  const inv = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } });
  return inv ? inv.onHand - inv.reserved : 0;
}

// Live recheck without changing anything. Returns null if OK, otherwise the reason.
export async function recheck(tx: Tx, plan: Plan): Promise<string | null> {
  const d = plan.details as Record<string, unknown>;
  if (plan.kind === "Reallocate stock") {
    for (const t of d.transfers as Transfer[]) {
      const free = await freeStock(tx, t.fromWarehouseId, t.productId);
      if (free < t.units) return `${t.fromWarehouseName} now has only ${free} free units of ${t.productName} (needs ${t.units}).`;
    }
  } else if (plan.kind === "Split order") {
    for (const u of d.shipNow as Unit[]) {
      const free = await freeStock(tx, d.warehouseId as string, u.productId);
      if (free < u.units) return `Only ${free} free units of ${u.productName} left to ship now (needs ${u.units}).`;
    }
  } else if (plan.kind === "Expedite shipment") {
    const s = await tx.shipment.findUnique({ where: { id: d.shipmentId as string } });
    if (!s || s.status === "Delivered") return `Shipment ${d.shipmentId as string} has already been delivered.`;
    if (!s.expectedArrivalAt) return `Shipment ${s.id} no longer has an arrival date to speed up.`;
  } else if (plan.kind === "Alternative supplier") {
    for (const p of d.purchases as Purchase[]) {
      const sup = await tx.supplier.findUnique({ where: { id: p.supplierId } });
      if (!sup?.active) return `${p.supplierName} is no longer an active supplier.`;
    }
  }
  return null;
}

// Applies the plan. Throws Blocked (and changes nothing) if live data no longer allows it.
export async function applyPlan(tx: Tx, plan: Plan, now = new Date()): Promise<string> {
  const reason = await recheck(tx, plan);
  if (reason) throw new Blocked(reason);
  const d = plan.details as Record<string, unknown>;
  let linkStatus = "Recovered";
  let done = "";

  if (plan.kind === "Reallocate stock") {
    const to = d.toWarehouseId as string;
    for (const t of d.transfers as Transfer[]) {
      if (!(await takeFree(tx, t.fromWarehouseId, t.productId, t.units, false))) {
        throw new Blocked(`${t.fromWarehouseName} no longer has ${t.units} free units of ${t.productName}.`);
      }
      await tx.inventory.update({
        where: { warehouseId_productId: { warehouseId: to, productId: t.productId } },
        data: { onHand: { increment: t.units }, reserved: { increment: t.units }, updatedAt: now },
      });
    }
    done = `Moved stock to ${d.toWarehouseName as string} and reserved it for ${plan.orderId}.`;
  } else if (plan.kind === "Split order") {
    for (const u of d.shipNow as Unit[]) {
      if (!(await takeFree(tx, d.warehouseId as string, u.productId, u.units, true))) {
        throw new Blocked(`No longer enough free ${u.productName} to ship now.`);
      }
    }
    linkStatus = "Recovering";
    done = `Reserved the in-stock units of ${plan.orderId} for on-time shipping; the rest follows.`;
  } else if (plan.kind === "Expedite shipment") {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id: d.shipmentId as string } });
    const days = d.daysRecovered as number;
    await tx.shipment.update({
      where: { id: s.id },
      data: { expectedArrivalAt: new Date(s.expectedArrivalAt!.getTime() - days * DAY_MS), delayDays: Math.max(0, s.delayDays - days), status: "Expedited" },
    });
    done = `Shipment ${s.id} upgraded to priority freight: ${days} day${days === 1 ? "" : "s"} sooner.`;
  } else if (plan.kind === "Alternative supplier") {
    const purchases = d.purchases as Purchase[];
    const bySupplier = new Map<string, Purchase[]>();
    for (const p of purchases) bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), p]);
    const ids: string[] = [];
    for (const [supplierId, items] of bySupplier) {
      const id = await nextId(tx, "altShipment", "SHP-ALT");
      const lead = Math.max(...items.map((p) => p.leadTimeDays));
      await tx.shipment.create({
        data: {
          id, supplierId, warehouseId: d.warehouseId as string, carrier: "Supplier delivery", trackingNumber: id,
          plannedDispatchAt: now, expectedArrivalAt: new Date(now.getTime() + lead * DAY_MS), status: "Ordered", delayDays: 0,
          items: { create: items.map((p, i) => ({ id: `${id}-${i + 1}`, productId: p.productId, quantity: p.units })) },
        },
      });
      for (const p of items) {
        await tx.inventory.update({
          where: { warehouseId_productId: { warehouseId: d.warehouseId as string, productId: p.productId } },
          data: { inbound: { increment: p.units }, updatedAt: now },
        });
      }
      ids.push(id);
    }
    linkStatus = "Recovering";
    done = `Purchase order${ids.length > 1 ? "s" : ""} ${ids.join(", ")} placed with the alternative supplier.`;
  }

  await tx.disruptionOrder.update({
    where: { disruptionId_orderId: { disruptionId: plan.disruptionId, orderId: plan.orderId } },
    data: { status: linkStatus },
  });
  const stillAtRisk = await tx.disruptionOrder.count({ where: { disruptionId: plan.disruptionId, status: "At risk" } });
  if (stillAtRisk === 0) await tx.disruption.update({ where: { id: plan.disruptionId }, data: { status: "Resolved" } });
  return done;
}
