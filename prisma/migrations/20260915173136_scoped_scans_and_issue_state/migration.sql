-- DropForeignKey
ALTER TABLE "ResolvedFinding" DROP CONSTRAINT "ResolvedFinding_auditId_fkey";

-- AlterTable
ALTER TABLE "Audit" DROP COLUMN "previousAuditId",
DROP COLUMN "sources",
ADD COLUMN     "evaluatedRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'full';

-- DropTable
DROP TABLE "ResolvedFinding";

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT,
    "recommendation" TEXT,
    "evidenceType" TEXT,
    "evidenceValue" TEXT,
    "pageUrl" TEXT,
    "targetId" TEXT,
    "targetTitle" TEXT,
    "imageUrl" TEXT,
    "fixableByAI" BOOLEAN NOT NULL DEFAULT false,
    "fixType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAuditId" TEXT NOT NULL,
    "openedAuditId" TEXT NOT NULL,
    "openedAsNew" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedAuditId" TEXT,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_shopId_status_idx" ON "Issue"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_shopId_fingerprint_key" ON "Issue"("shopId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

