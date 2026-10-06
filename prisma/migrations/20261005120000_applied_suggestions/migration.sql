-- A draft the merchant approves is written to the store. Record when, and
-- what it replaced, so the change can be undone.
ALTER TABLE "Suggestion" ADD COLUMN "appliedAt" TIMESTAMP(3);
ALTER TABLE "Suggestion" ADD COLUMN "previous" TEXT;
