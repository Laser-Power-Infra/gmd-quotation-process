-- CF set (flanges + gaskets + bolts + nuts) as a child line under a valve.
ALTER TABLE "EnquiryItem" ADD COLUMN "parentItemId" TEXT;
ALTER TABLE "EnquiryItem" ADD COLUMN "cfSetBreakdown" JSONB;
ALTER TABLE "flange" ADD COLUMN "gasketWeightKg" TEXT;

CREATE UNIQUE INDEX "EnquiryItem_parentItemId_key" ON "EnquiryItem"("parentItemId");

ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_parentItemId_fkey"
  FOREIGN KEY ("parentItemId") REFERENCES "EnquiryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Item type for the child line, so the details check passes.
INSERT INTO "LookupOption" ("id", "type", "value", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'ITEM_TYPE', 'CF SET', 1000, true, now(), now())
ON CONFLICT ("type", "value") DO NOTHING;

-- Editable rate rows ("<key>=<Rs/kg>;from=<date>", edit at /admin/lookup-options). A blank flange/fastener
-- rate falls back to the casting rate of the same key; blank machining counts as 0.
INSERT INTO "LookupOption" ("id", "type", "value", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t.type, t.value, t.ord, true, now(), now()
FROM (VALUES
  ('CF_FLANGE_RATE', 'MS=', 0), ('CF_FLANGE_RATE', 'CS=', 1), ('CF_FLANGE_RATE', 'CI=', 2),
  ('CF_FLANGE_RATE', 'DI=', 3), ('CF_FLANGE_RATE', 'SS=', 4),
  ('CF_FASTENER_RATE', 'GI=', 0), ('CF_FASTENER_RATE', 'CS=', 1), ('CF_FASTENER_RATE', 'SS=', 2), ('CF_FASTENER_RATE', 'AS=', 3),
  ('CF_GASKET_RATE', 'RUBBER=', 0), ('CF_GASKET_RATE', 'CAF=', 1),
  ('CF_MACHINING', '<=100=0', 0), ('CF_MACHINING', '150-300=0', 1), ('CF_MACHINING', '350-600=0', 2), ('CF_MACHINING', '>600=0', 3)
) AS t(type, value, ord)
ON CONFLICT ("type", "value") DO NOTHING;
