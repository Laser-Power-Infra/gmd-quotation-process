import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { roundUp } from "@/lib/rounding";

/**
 * One-time retroactive fix: rounds fractional EnquiryItem.quotedRate up to the next integer
 * (whole numbers are left as-is). Keeps vaPercent as-is, recomputes GST + totals on rounded QR.
 * Usage:
 *   npx tsx scripts/round-qr.ts           // dry-run (no writes)
 *   npx tsx scripts/round-qr.ts --apply   // writes
 */

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Round QR up (fractional → next integer) — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n`);

  const items = await prisma.enquiryItem.findMany({
    where: { quotedRate: { not: null } },
    select: {
      id: true,
      quotedRate: true,
      quotedRateGst: true,
      quantity: true,
      vaPercent: true,
      cost: true,
      itemName: true,
      enquiryId: true,
    },
  });

  console.log(`Found ${items.length} items with quotedRate != null`);

  type ToUpdate = {
    id: string;
    cur: string;
    rounded: string;
    gst: string;
    itemWise: string | null;
    total: string | null;
    itemName: string;
  };

  const toUpdate: ToUpdate[] = [];

  for (const it of items) {
    const curNum = parseFloat(String(it.quotedRate));
    if (isNaN(curNum)) continue;
    const roundedNum = roundUp(curNum);
    // Keep 2 decimals string compare; skip if already a whole number
    const curStr = curNum.toFixed(2);
    const roundedStr = roundedNum.toFixed(2);
    if (curStr === roundedStr) continue;

    const qty = Number(it.quantity);
    const gst = (roundedNum * 1.18).toFixed(2);
    const itemWise = qty > 0 ? (qty * roundedNum).toFixed(2) : null;
    const total = qty > 0 ? (qty * roundedNum * 1.18).toFixed(2) : null;

    toUpdate.push({
      id: it.id,
      cur: curStr,
      rounded: roundedStr,
      gst,
      itemWise,
      total,
      itemName: it.itemName.substring(0, 60),
    });
  }

  console.log(`To round: ${toUpdate.length} items (skipped ${items.length - toUpdate.length} already whole numbers)\n`);

  if (toUpdate.length === 0) {
    console.log("No items to update. Exiting.");
    return;
  }

  // Show sample
  const sample = toUpdate.slice(0, 20);
  console.table(
    sample.map((u) => ({
      id: u.id.substring(0, 8) + "...",
      itemName: u.itemName,
      "cur → rounded": `${u.cur} → ${u.rounded}`,
      gst: u.gst,
    }))
  );
  if (toUpdate.length > 20) {
    console.log(`... and ${toUpdate.length - 20} more (not shown)\n`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. Run with --apply to write to DB.\n");
    console.log("Example: npx tsx scripts/round-qr.ts --apply\n");
    return;
  }

  console.log("\nApplying updates...\n");
  let updated = 0;
  for (const u of toUpdate) {
    await prisma.enquiryItem.update({
      where: { id: u.id },
      data: {
        quotedRate: u.rounded,
        quotedRateGst: u.gst,
        itemWiseTotalValue: u.itemWise,
        totalValue: u.total,
        // vaPercent intentionally not touched — keep as-is per spec
      },
    });
    updated++;
    if (updated % 100 === 0) {
      process.stdout.write(`\rUpdated ${updated}/${toUpdate.length}...`);
    }
  }
  console.log(`\n\nDone. Updated ${updated} items.\n`);
  console.log(`Verify: SELECT COUNT(*) FROM "EnquiryItem" WHERE quotedRate::numeric - floor(quotedRate::numeric) != 0; -- should be 0\n`);
}

main()
  .catch((e) => {
    console.error("Error in round-qr script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
