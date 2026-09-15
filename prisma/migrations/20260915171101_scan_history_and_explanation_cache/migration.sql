-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "newCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previousAuditId" TEXT,
ADD COLUMN     "resolvedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3),
ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ResolvedFinding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pageUrl" TEXT,
    "targetTitle" TEXT,
    "imageUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolvedFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplanationCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExplanationCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResolvedFinding_auditId_idx" ON "ResolvedFinding"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "ExplanationCache_shopId_ruleId_key" ON "ExplanationCache"("shopId", "ruleId");

-- AddForeignKey
ALTER TABLE "ResolvedFinding" ADD CONSTRAINT "ResolvedFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExplanationCache" ADD CONSTRAINT "ExplanationCache_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
