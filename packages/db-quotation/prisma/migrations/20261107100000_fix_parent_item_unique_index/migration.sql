-- CF set: one valve can have many child lines, so parentItemId must not be unique.
-- DropIndex
DROP INDEX IF EXISTS "EnquiryItem_parentItemId_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EnquiryItem_parentItemId_idx" ON "EnquiryItem"("parentItemId");
