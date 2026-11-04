-- Flange dimensions captured per serial on the heat-entry page.
ALTER TABLE "HeatEntry" ADD COLUMN "od" TEXT;
ALTER TABLE "HeatEntry" ADD COLUMN "id_mm" TEXT;
ALTER TABLE "HeatEntry" ADD COLUMN "pcd" TEXT;
ALTER TABLE "HeatEntry" ADD COLUMN "bolt_holes" TEXT;
ALTER TABLE "HeatEntry" ADD COLUMN "flange_thickness" TEXT;
