/*
  Warnings:

  - You are about to drop the column `mail_trigger` on the `pbg_data` table. All the data in the column will be lost.
  - You are about to drop the `pbg_reminder_log` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "pbg_reminder_log" DROP CONSTRAINT "pbg_reminder_log_pbg_id_fkey";

-- AlterTable
ALTER TABLE "flange" ADD COLUMN     "gasketCost" TEXT;

-- AlterTable
ALTER TABLE "pbg_data" DROP COLUMN "mail_trigger";

-- DropTable
DROP TABLE "pbg_reminder_log";
