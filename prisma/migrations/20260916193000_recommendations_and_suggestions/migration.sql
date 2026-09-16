-- Recommendation-first model: StoreRx recommends, the merchant implements.
-- The Fix table described an auto-apply workflow that was never implemented
-- and is no longer the product; Suggestion replaces it with drafted copy that
-- is only ever read.

-- DropForeignKey
ALTER TABLE "Fix" DROP CONSTRAINT "Fix_shopId_fkey";

-- DropTable
DROP TABLE "Fix";

-- AlterTable
ALTER TABLE "Issue" DROP COLUMN "fixableByAI",
DROP COLUMN "fixType",
ADD COLUMN     "remedy" TEXT NOT NULL DEFAULT 'messaging',
ADD COLUMN     "adminArea" TEXT,
ADD COLUMN     "adminRef" TEXT,
ADD COLUMN     "suggestionKind" TEXT,
ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "markedResolvedAt" TIMESTAMP(3),
ADD COLUMN     "verificationFailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Finding" DROP COLUMN "fixableByAI",
DROP COLUMN "fixType",
ADD COLUMN     "remedy" TEXT NOT NULL DEFAULT 'messaging',
ADD COLUMN     "adminArea" TEXT,
ADD COLUMN     "adminRef" TEXT,
ADD COLUMN     "suggestionKind" TEXT,
ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "current" TEXT,
    "suggested" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_shopId_createdAt_idx" ON "Suggestion"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_issueId_targetId_kind_key" ON "Suggestion"("issueId", "targetId", "kind");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ExplanationCache" ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[];
