-- CreateTable
CREATE TABLE "actuator_options" (
    "id" SERIAL NOT NULL,
    "optionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actuator_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "actuator_options_optionName_key" ON "actuator_options"("optionName");
