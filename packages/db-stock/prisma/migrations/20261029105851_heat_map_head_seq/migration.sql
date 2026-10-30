/*
  Warnings:

  - A unique constraint covering the columns `[heat_no,heat_seq]` on the table `PhysicalStock` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PhysicalStock" ADD COLUMN     "heat_no" TEXT,
ADD COLUMN     "heat_seq" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalStock_heat_no_heat_seq_key" ON "PhysicalStock"("heat_no", "heat_seq");
