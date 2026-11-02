-- CreateTable
CREATE TABLE "SerialDimension" (
    "id" TEXT NOT NULL,
    "physical_stock_id" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "standard" JSONB,
    "flags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialDimension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SerialDimension_physical_stock_id_key" ON "SerialDimension"("physical_stock_id");
