-- One numbered entry per New Item submit (SE-<fy>-<seq>), many per PhysicalStock row.
CREATE TABLE "StockEntry" (
    "id" TEXT NOT NULL,
    "entry_no" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "entry_seq" INTEGER NOT NULL,
    "physical_stock_id" TEXT NOT NULL,
    "qty_type" TEXT NOT NULL,
    "qty" TEXT,
    "merged" BOOLEAN NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockEntry_entry_no_key" ON "StockEntry"("entry_no");
CREATE UNIQUE INDEX "StockEntry_fy_entry_seq_key" ON "StockEntry"("fy", "entry_seq");
CREATE INDEX "StockEntry_physical_stock_id_idx" ON "StockEntry"("physical_stock_id");

ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_physical_stock_id_fkey" FOREIGN KEY ("physical_stock_id") REFERENCES "PhysicalStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
