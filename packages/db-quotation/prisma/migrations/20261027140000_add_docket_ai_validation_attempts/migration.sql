-- AlterTable
ALTER TABLE "docket_quotation_threads"
  ADD COLUMN "ai_validation_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ai_validation_last_error" TEXT;

-- CreateIndex
CREATE INDEX "idx_dqt_pending_docket" ON "docket_quotation_threads"("pendingDocket");

-- CreateIndex
CREATE INDEX "idx_dqt_ai_validation_attempts" ON "docket_quotation_threads"("ai_validation_attempts");
