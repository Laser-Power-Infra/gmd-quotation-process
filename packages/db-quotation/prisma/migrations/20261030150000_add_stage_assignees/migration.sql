-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "detailsAssigneeId" TEXT,
ADD COLUMN     "costAssigneeId" TEXT,
ADD COLUMN     "validationAssigneeId" TEXT,
ADD COLUMN     "sendAssigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_detailsAssigneeId_fkey" FOREIGN KEY ("detailsAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_costAssigneeId_fkey" FOREIGN KEY ("costAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_validationAssigneeId_fkey" FOREIGN KEY ("validationAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_sendAssigneeId_fkey" FOREIGN KEY ("sendAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
