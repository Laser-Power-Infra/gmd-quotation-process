-- AlterTable
ALTER TABLE "GeneratedImage" ADD COLUMN     "itemCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
