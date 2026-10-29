-- AlterTable
ALTER TABLE "pbg_reminder_log" ADD COLUMN     "po_number" TEXT,
ADD COLUMN     "recipient_key" TEXT;

-- CreateIndex
CREATE INDEX "idx_pbg_reminder_po_recipient_stage_sent" ON "pbg_reminder_log"("po_number", "recipient_key", "stage", "sent_at");
