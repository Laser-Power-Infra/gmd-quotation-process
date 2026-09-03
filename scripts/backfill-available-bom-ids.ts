import { prisma } from "@/lib/prisma";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  console.log(`\n=== Backfill availableBomIds ${dryRun ? "(DRY RUN - no writes)" : "(WRITE MODE)"} ===`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { not: null } },
    select: { id: true, enquiryId: true, itemName: true, erpItemCode: true, bomId: true, availableBomIds: true },
    orderBy: { erpItemCode: "asc" },
  });

  const actionable = limit > 0 ? items.slice(0, limit) : items;
  console.log(`Found ${items.length} items with erpItemCode, processing ${actionable.length}`);

  const codes = [...new Set(actionable.map((i) => i.erpItemCode!).filter(Boolean))];
  console.log(`Distinct codes: ${codes.length}`);

  const map = await getBatchDistinctBomIds(codes);

  // Show preview of multi-BOM codes
  const multiCodes = [...map.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`\n--- VerifyBom multi-BOM codes: ${multiCodes.length} have >1 distinct bomId ---`);
  for (const [code, ids] of multiCodes.slice(0, 20)) {
    console.log(`  ${code}: ${ids.length} BOMs => ${ids.join(", ")}`);
  }
  if (multiCodes.length > 20) console.log(`  ... and ${multiCodes.length - 20} more`);

  const zeroCodes = [...map.entries()].filter(([, ids]) => ids.length === 0);
  console.log(`Zero BOM codes: ${zeroCodes.length}`);
  const singleCodes = [...map.entries()].filter(([, ids]) => ids.length === 1);
  console.log(`Single BOM codes: ${singleCodes.length}`);

  // Per-item preview
  let willUpdate = 0;
  let alreadyCorrect = 0;
  const previewRows: any[] = [];
  for (const it of actionable) {
    const ids = map.get(it.erpItemCode!) ?? [];
    const current = it.availableBomIds ?? [];
    const same = current.length === ids.length && current.every((v, i) => v === ids[i]);
    if (!same) willUpdate++;
    else alreadyCorrect++;

    if (ids.length > 1 || !same) {
      previewRows.push({
        itemId: it.id.slice(0, 8),
        erpItemCode: it.erpItemCode,
        bomId: it.bomId || "-",
        currentAvailable: current.length ? current.join(",") : "-",
        newAvailable: ids.length ? ids.join(",") : "-",
        willUpdate: !same,
      });
    }
  }

  console.log(`\n--- Items preview (showing multi or diff, first 30) ---`);
  console.table(previewRows.slice(0, 30));
  console.log(`Will update: ${willUpdate}, Already correct: ${alreadyCorrect}`);

  if (dryRun) {
    console.log(`\nDry run complete. No DB writes. Run with --write to persist.`);
    console.log(`  npx tsx scripts/backfill-available-bom-ids.ts --write`);
    if (limit) console.log(`  (remove --limit to process all)`);
  } else {
    console.log(`\nWriting...`);
    let updated = 0;
    for (const it of actionable) {
      const ids = map.get(it.erpItemCode!) ?? [];
      const current = it.availableBomIds ?? [];
      const same = current.length === ids.length && current.every((v, i) => v === ids[i]);
      if (same) continue;
      await prisma.enquiryItem.update({ where: { id: it.id }, data: { availableBomIds: ids } });
      updated++;
      if (updated % 500 === 0) console.log(`  updated ${updated}...`);
    }
    console.log(`Done. Updated ${updated} items.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
