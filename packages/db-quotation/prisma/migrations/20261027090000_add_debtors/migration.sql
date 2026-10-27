-- CreateTable
CREATE TABLE "debtors" (
    "id" TEXT NOT NULL,
    "acc_sch" TEXT,
    "acc_code" TEXT NOT NULL,
    "t_code" TEXT,
    "vr_no" TEXT,
    "dr_amt" DECIMAL(18,2),
    "vr_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "particular" TEXT,
    "dr_alloc_amt" DECIMAL(18,2),
    "un_alloc_dr" DECIMAL(18,2),
    "un_alloc_cr" DECIMAL(18,2),
    "party_bill_no" TEXT,
    "party_bill_date" TIMESTAMP(3),
    "acc_name" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debtors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debtors_due_date_idx" ON "debtors"("due_date");

-- CreateIndex
CREATE INDEX "debtors_acc_code_idx" ON "debtors"("acc_code");

-- CreateIndex
CREATE UNIQUE INDEX "debtors_acc_code_t_code_vr_no_key" ON "debtors"("acc_code", "t_code", "vr_no");
