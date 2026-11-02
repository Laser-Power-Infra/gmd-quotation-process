-- CreateTable
CREATE TABLE "valve_serial" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "heatEntryId" TEXT,
    "contractNo" TEXT,
    "valveType" TEXT,
    "sizeDn" TEXT,
    "pnRating" TEXT,
    "odMm" TEXT,
    "idMm" TEXT,
    "pcdMm" TEXT,
    "boltHoles" TEXT,
    "holeDiaMm" TEXT,
    "flangeThicknessMm" TEXT,
    "faceToFaceMm" TEXT,
    "heightOpenMm" TEXT,
    "heightClosedMm" TEXT,
    "weightKg" TEXT,
    "flangeStandard" TEXT,
    "bodyMoc" TEXT,
    "discMoc" TEXT,
    "seatMoc" TEXT,
    "actuatorGearbox" TEXT,
    "standard" JSONB,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valve_serial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "valve_serial_serialNo_key" ON "valve_serial"("serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "valve_serial_heatEntryId_key" ON "valve_serial"("heatEntryId");
