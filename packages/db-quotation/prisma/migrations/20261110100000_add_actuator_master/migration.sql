-- CreateTable
CREATE TABLE "ActuatorMaster" (
    "actCode" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "series" TEXT,
    "model" TEXT,
    "motion" TEXT,
    "minTorque" DOUBLE PRECISION,
    "maxTorque" DOUBLE PRECISION,
    "valveFlange" TEXT,
    "speedRange" TEXT,
    "dutyOptions" TEXT,
    "dataStatus" TEXT,
    "price" DOUBLE PRECISION,
    "leadTimeWeeks" DOUBLE PRECISION,
    "offerDate" TIMESTAMP(3),
    "offerValidTill" TIMESTAMP(3),
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActuatorMaster_pkey" PRIMARY KEY ("actCode")
);

-- CreateTable
CREATE TABLE "GearboxMaster" (
    "gbCode" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT,
    "maxOutputTorque" DOUBLE PRECISION,
    "torqueFactor" DOUBLE PRECISION,
    "topFlange" TEXT,
    "baseFlange" TEXT,
    "dataStatus" TEXT,
    "price" DOUBLE PRECISION,
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GearboxMaster_pkey" PRIMARY KEY ("gbCode")
);

-- CreateTable
CREATE TABLE "ValveTorque" (
    "key" TEXT NOT NULL,
    "valveType" TEXT NOT NULL,
    "dn" INTEGER NOT NULL,
    "motion" TEXT,
    "indicativeTorque" DOUBLE PRECISION,
    "dataStatus" TEXT,
    "indicativeFlange" TEXT,
    "flangeStd" TEXT,
    "gmdTorque" DOUBLE PRECISION,
    "gmdTopFlange" TEXT,
    "effectiveFlange" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValveTorque_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ActuatorParam" (
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "ActuatorParam_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ActuatorMapping" (
    "mapKey" TEXT NOT NULL,
    "valveType" TEXT NOT NULL,
    "dn" INTEGER NOT NULL,
    "pn" TEXT NOT NULL,
    "valveTorque" DOUBLE PRECISION,
    "requiredTorque" DOUBLE PRECISION,
    "gearbox" TEXT,
    "gbFactor" DOUBLE PRECISION,
    "actInputTorque" DOUBLE PRECISION,
    "aumaModel" TEXT,
    "aumaActCode" TEXT,
    "rotorkModel" TEXT,
    "rotorkActCode" TEXT,
    "directPartTurn" TEXT,
    "stockRotorkNm" DOUBLE PRECISION,
    "stockRotorkQty" DOUBLE PRECISION,
    "valveFlange" TEXT,
    "gbBaseFlange" TEXT,
    "gbTopFlange" TEXT,
    "actFlange" TEXT,
    "flangeCheck" TEXT,
    "gmdGbCode" TEXT,
    "gmdGbRating" DOUBLE PRECISION,
    "gmdGbAvailable" DOUBLE PRECISION,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActuatorMapping_pkey" PRIMARY KEY ("mapKey")
);

-- CreateTable
CREATE TABLE "ActuatorSuitability" (
    "mapKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ratingNm" DOUBLE PRECISION,
    "mark" TEXT NOT NULL,

    CONSTRAINT "ActuatorSuitability_pkey" PRIMARY KEY ("mapKey","code")
);

-- CreateTable
CREATE TABLE "GmdGearboxStock" (
    "erpCode" TEXT NOT NULL,
    "gbType" TEXT,
    "ratedTorque" DOUBLE PRECISION,
    "received" DOUBLE PRECISION,
    "dispatched" DOUBLE PRECISION,
    "available" DOUBLE PRECISION,
    "stockPerErp" DOUBLE PRECISION,
    "erpGap" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "stockValue" DOUBLE PRECISION,
    "baseFlange" TEXT,
    "topFlange" TEXT,
    "suitsBfvPn10" DOUBLE PRECISION,
    "suitsBfvPn16" DOUBLE PRECISION,
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmdGearboxStock_pkey" PRIMARY KEY ("erpCode")
);

-- CreateTable
CREATE TABLE "ActuatorStock" (
    "erpCode" TEXT NOT NULL,
    "l6Code" TEXT,
    "ratingCode" TEXT,
    "series" TEXT,
    "torque" DOUBLE PRECISION,
    "outputRpm" DOUBLE PRECISION,
    "make" TEXT,
    "actCode" TEXT,
    "received" DOUBLE PRECISION,
    "dispatched" DOUBLE PRECISION,
    "available" DOUBLE PRECISION,
    "physicalSum" DOUBLE PRECISION,
    "stockPerErp" DOUBLE PRECISION,
    "erpGap" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "stockValue" DOUBLE PRECISION,
    "moving3m" TEXT,
    "dispatched2627" DOUBLE PRECISION,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActuatorStock_pkey" PRIMARY KEY ("erpCode")
);

-- CreateIndex
CREATE INDEX "ActuatorMapping_valveType_dn_idx" ON "ActuatorMapping"("valveType", "dn");

-- CreateIndex
CREATE INDEX "ActuatorSuitability_code_idx" ON "ActuatorSuitability"("code");

-- CreateIndex
CREATE INDEX "ActuatorStock_actCode_idx" ON "ActuatorStock"("actCode");
