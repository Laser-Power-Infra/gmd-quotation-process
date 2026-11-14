/** Fill GeneratedImage.itemCodes from the current enquiry items. Safe to re-run. */
import { prisma } from "@/lib/prisma";
import { syncGeneratedImageItemCodes } from "@/lib/generatedImageItemCodes";

syncGeneratedImageItemCodes()
  .then((r) => console.log(`[generated images] itemCodes rewritten on ${r.updated} row(s).`))
  .catch((e) => {
    console.error("[sync-generated-image-item-codes] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
