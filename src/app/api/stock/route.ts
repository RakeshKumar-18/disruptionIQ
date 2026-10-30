import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { iso } from "@/lib/records";

const PAGE = 50;

// Stock lookup: search by product ID/name, filter by warehouse, 50 rows per page.
export const GET = route(async (req) => {
  await requirePermission("stock");
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const warehouseId = sp.get("warehouse") || undefined;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const where: Prisma.InventoryWhereInput = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(q ? { OR: [{ productId: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows, warehouses] = await Promise.all([
    db.inventory.count({ where }),
    db.inventory.findMany({
      where, include: { product: true, warehouse: true }, orderBy: [{ warehouseId: "asc" }, { productId: "asc" }],
      skip: (page - 1) * PAGE, take: PAGE,
    }),
    db.warehouse.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    total, page, pages: Math.max(1, Math.ceil(total / PAGE)), warehouses,
    rows: rows.map((r) => ({
      warehouse: r.warehouse.name, warehouseId: r.warehouseId, productId: r.productId, product: r.product.name, criticality: r.product.criticality,
      onHand: r.onHand, reserved: r.reserved, free: r.onHand - r.reserved, inbound: r.inbound, reorderLevel: r.product.reorderLevel,
      low: r.onHand - r.reserved < r.product.reorderLevel, updatedAt: iso(r.updatedAt),
    })),
  };
});
