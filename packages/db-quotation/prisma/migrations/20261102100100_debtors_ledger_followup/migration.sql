-- CreateTable
CREATE TABLE "LedgerFollowUpLog" (
    "id" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,
    "accCode" TEXT NOT NULL,
    "vrNo" TEXT NOT NULL DEFAULT '',
    "owner" TEXT,
    "lastFollowUp" TIMESTAMP(3),
    "promisedDate" TIMESTAMP(3),
    "promisedAmount" DECIMAL(18,2),
    "nextActionDate" TIMESTAMP(3),
    "status" TEXT,
    "remarks" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerFollowUpLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerFollowUpLog_ledger_accCode_changedAt_idx" ON "LedgerFollowUpLog"("ledger", "accCode", "changedAt");
