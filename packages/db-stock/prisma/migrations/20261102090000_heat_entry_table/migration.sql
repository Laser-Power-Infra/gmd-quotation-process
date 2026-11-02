-- HeatEntry: one row per heat of a PhysicalStock row (1 -> N). Existing
-- heat_no/heat_seq pairs are copied over before the columns are dropped.
CREATE TABLE "HeatEntry" (
    "id" TEXT NOT NULL,
    "physical_stock_id" TEXT NOT NULL,
    "heat_no" TEXT NOT NULL,
    "heat_seq" INTEGER NOT NULL,
    "sheet_file_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HeatEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HeatEntry_heat_no_heat_seq_key" ON "HeatEntry"("heat_no", "heat_seq");
CREATE INDEX "HeatEntry_physical_stock_id_idx" ON "HeatEntry"("physical_stock_id");

ALTER TABLE "HeatEntry" ADD CONSTRAINT "HeatEntry_physical_stock_id_fkey"
  FOREIGN KEY ("physical_stock_id") REFERENCES "PhysicalStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "HeatEntry" ("id", "physical_stock_id", "heat_no", "heat_seq", "created_at")
SELECT 'he_' || "id", "id", "heat_no", "heat_seq", "updated_at"
FROM "PhysicalStock"
WHERE "heat_no" IS NOT NULL AND "heat_seq" IS NOT NULL;

ALTER TABLE "PhysicalStock" ADD COLUMN "heat_done" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "PhysicalStock_heat_no_heat_seq_key";
ALTER TABLE "PhysicalStock" DROP COLUMN "heat_no", DROP COLUMN "heat_seq";
