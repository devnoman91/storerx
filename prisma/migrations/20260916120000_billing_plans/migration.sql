-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "units" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT;

-- CreateIndex
CREATE INDEX "AiUsage_shopId_createdAt_idx" ON "AiUsage"("shopId", "createdAt");

