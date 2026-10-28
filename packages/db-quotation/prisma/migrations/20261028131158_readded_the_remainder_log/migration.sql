-- AlterTable
ALTER TABLE "pbg_data" ADD COLUMN     "mail_trigger" TEXT DEFAULT 'HOLD';

-- CreateTable
CREATE TABLE "pbg_reminder_log" (
    "id" BIGSERIAL NOT NULL,
    "pbg_id" BIGINT NOT NULL,
    "stage" TEXT NOT NULL,
    "emails" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pbg_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pbg_reminder_pbg_stage_sent" ON "pbg_reminder_log"("pbg_id", "stage", "sent_at");

-- CreateIndex
CREATE INDEX "idx_pbg_reminder_stage_status" ON "pbg_reminder_log"("stage", "status");

-- AddForeignKey
ALTER TABLE "pbg_reminder_log" ADD CONSTRAINT "pbg_reminder_log_pbg_id_fkey" FOREIGN KEY ("pbg_id") REFERENCES "pbg_data"("id") ON DELETE CASCADE ON UPDATE CASCADE;
