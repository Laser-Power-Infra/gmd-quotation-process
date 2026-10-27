/*
  Warnings:

  - You are about to drop the column `createdAt` on the `actuator_options` table. All the data in the column will be lost.
  - You are about to drop the column `optionName` on the `actuator_options` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[value]` on the table `actuator_options` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `value` to the `actuator_options` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "actuator_options_optionName_key";

-- AlterTable
ALTER TABLE "actuator_options" DROP COLUMN "createdAt",
DROP COLUMN "optionName",
ADD COLUMN     "rmCodeForActuator" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "value" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "actuator_options_value_key" ON "actuator_options"("value");
