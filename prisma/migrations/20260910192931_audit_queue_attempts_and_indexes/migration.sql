-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Audit_status_createdAt_idx" ON "Audit"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_shopId_status_idx" ON "Audit"("shopId", "status");
