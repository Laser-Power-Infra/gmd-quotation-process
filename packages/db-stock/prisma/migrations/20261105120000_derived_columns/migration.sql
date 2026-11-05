-- Derived columns stored so the stock page can filter/sort them in SQL (filled by refreshDerived()).
ALTER TABLE "PhysicalStock" ADD COLUMN "fg_item_code" TEXT;
ALTER TABLE "PhysicalStock" ADD COLUMN "production_item" TEXT;
ALTER TABLE "HeatEntry" ADD COLUMN "serial_no" TEXT;
