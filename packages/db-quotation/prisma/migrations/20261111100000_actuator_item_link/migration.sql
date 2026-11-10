-- AlterTable
ALTER TABLE "EnquiryItem" ADD COLUMN "actuatorMake" TEXT,
ADD COLUMN "actCode" TEXT,
ADD COLUMN "gbCode" TEXT,
ADD COLUMN "controlType" TEXT,
ADD COLUMN "bareValveCost" DECIMAL(65,30),
ADD COLUMN "adaptorCost" DECIMAL(65,30),
ADD COLUMN "assemblyCost" DECIMAL(65,30),
ADD COLUMN "actuatorBreakdown" JSONB;
