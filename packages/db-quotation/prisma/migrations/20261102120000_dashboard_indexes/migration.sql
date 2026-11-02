-- Dashboard performance: the stage CASE in the enquiry summary runs four correlated
-- EXISTS subqueries against "EnquiryItem" per "Enquiry" row, and the FK was unindexed,
-- so every one of them was a sequential scan.
-- CreateIndex
CREATE INDEX "EnquiryItem_enquiryId_idx" ON "EnquiryItem"("enquiryId");

-- Filters and sorting on the dashboard header and column filters.
-- CreateIndex
CREATE INDEX "Enquiry_enquiryDate_idx" ON "Enquiry"("enquiryDate");

-- CreateIndex
CREATE INDEX "Enquiry_closureStatus_idx" ON "Enquiry"("closureStatus");

-- CreateIndex
CREATE INDEX "Enquiry_partyName_idx" ON "Enquiry"("partyName");
