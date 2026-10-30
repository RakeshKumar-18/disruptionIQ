/*
  Warnings:

  - The primary key for the `CarrierEvent` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `eta` on the `CarrierEvent` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `CarrierEvent` table. All the data in the column will be lost.
  - You are about to drop the column `affectedSkus` on the `Disruption` table. All the data in the column will be lost.
  - You are about to drop the column `read` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `customer` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `due` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sku` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `approvedById` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `impact` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `destination` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `eta` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `lastEventId` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `origin` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `leadDays` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the `InventoryItem` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `delayDays` to the `CarrierEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `idempotencyKey` to the `CarrierEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `occurredAt` to the `CarrierEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `outcome` to the `CarrierEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `CarrierEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `delayDays` to the `Disruption` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deadline` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deliveryCity` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `approverRole` to the `Plan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `costInr` to the `Plan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `details` to the `Plan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `plannedDispatchAt` to the `Shipment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trackingNumber` to the `Shipment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `warehouseId` to the `Shipment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `city` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `leadTimeDays` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reliabilityPct` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `riskTier` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `capacityUnits` to the `Warehouse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `city` to the `Warehouse` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "Plan" DROP CONSTRAINT "Plan_approvedById_fkey";

-- AlterTable
ALTER TABLE "CarrierEvent" DROP CONSTRAINT "CarrierEvent_pkey",
DROP COLUMN "eta",
DROP COLUMN "status",
ADD COLUMN     "delayDays" INTEGER NOT NULL,
ADD COLUMN     "idempotencyKey" TEXT NOT NULL,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "outcome" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL,
ADD CONSTRAINT "CarrierEvent_pkey" PRIMARY KEY ("idempotencyKey");

-- AlterTable
ALTER TABLE "Disruption" DROP COLUMN "affectedSkus",
ADD COLUMN     "delayDays" INTEGER NOT NULL,
ADD COLUMN     "eventKey" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "warehouseId" TEXT,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "read",
ADD COLUMN     "targetRole" TEXT,
ADD COLUMN     "targetUserId" TEXT;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "customer",
DROP COLUMN "due",
DROP COLUMN "qty",
DROP COLUMN "sku",
ADD COLUMN     "customerId" TEXT NOT NULL,
ADD COLUMN     "deadline" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "deliveryCity" TEXT NOT NULL,
ALTER COLUMN "createdAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "approvedById",
DROP COLUMN "impact",
ADD COLUMN     "approverRole" TEXT NOT NULL,
ADD COLUMN     "costInr" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "details" JSONB NOT NULL,
ADD COLUMN     "executedById" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "proposed" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Shipment" DROP COLUMN "destination",
DROP COLUMN "eta",
DROP COLUMN "lastEventId",
DROP COLUMN "origin",
ADD COLUMN     "actualArrivalAt" TIMESTAMP(3),
ADD COLUMN     "expectedArrivalAt" TIMESTAMP(3),
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "plannedDispatchAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "trackingNumber" TEXT NOT NULL,
ADD COLUMN     "warehouseId" TEXT NOT NULL,
ALTER COLUMN "delayDays" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "leadDays",
DROP COLUMN "region",
DROP COLUMN "status",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "leadTimeDays" INTEGER NOT NULL,
ADD COLUMN     "reliabilityPct" INTEGER NOT NULL,
ADD COLUMN     "riskTier" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "capacityUnits" INTEGER NOT NULL,
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Active';

-- DropTable
DROP TABLE "InventoryItem";

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "criticality" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "inbound" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "penaltyPctPerDay" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "DisruptionOrder" (
    "disruptionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "unitsShort" INTEGER NOT NULL,
    "daysLate" INTEGER NOT NULL,
    "exposureInr" DOUBLE PRECISION NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "factors" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisruptionOrder_pkey" PRIMARY KEY ("disruptionId","orderId")
);

-- CreateTable
CREATE TABLE "Meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_warehouseId_productId_key" ON "Inventory"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "DisruptionOrder_orderId_idx" ON "DisruptionOrder"("orderId");

-- CreateIndex
CREATE INDEX "Order_warehouseId_deadline_idx" ON "Order"("warehouseId", "deadline");

-- CreateIndex
CREATE INDEX "Shipment_supplierId_idx" ON "Shipment"("supplierId");

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisruptionOrder" ADD CONSTRAINT "DisruptionOrder_disruptionId_fkey" FOREIGN KEY ("disruptionId") REFERENCES "Disruption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisruptionOrder" ADD CONSTRAINT "DisruptionOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
