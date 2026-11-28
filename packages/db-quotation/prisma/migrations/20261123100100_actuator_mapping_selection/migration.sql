-- Mapping page: the app's own actuator + gearbox pick per MAP KEY, stored when the tables are refreshed from the live sheet.
-- origin: INDIAN (MAPPING rows; blank on rows stored before the first refresh) or IMPORTED (Tianjin Tangfa "TFW" rows).
ALTER TABLE "ActuatorMapping"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "valveTurns" DOUBLE PRECISION,
  ADD COLUMN "selGearbox" TEXT,
  ADD COLUMN "selGbRatio" TEXT,
  ADD COLUMN "selActuator" TEXT,
  ADD COLUMN "selActRpm" DOUBLE PRECISION,
  ADD COLUMN "selTotal" DOUBLE PRECISION,
  ADD COLUMN "selTime" DOUBLE PRECISION,
  ADD COLUMN "selTimeCheck" TEXT,
  ADD COLUMN "selFlags" TEXT;
