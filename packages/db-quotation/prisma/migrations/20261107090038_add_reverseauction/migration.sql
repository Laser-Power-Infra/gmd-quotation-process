-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "reverseAuctionCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReverseAuctionSend" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReverseAuctionSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReverseAuctionSend_enquiryId_round_key" ON "ReverseAuctionSend"("enquiryId", "round");

-- AddForeignKey
ALTER TABLE "ReverseAuctionSend" ADD CONSTRAINT "ReverseAuctionSend_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
