import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncRmDrawings } from "../lib/gmd_lib/rmDrawings";

/**
 * Fills RawMaterial.drawingUrl from Puja's "RM drawing map (Asmita)" sheet
 * (spreadsheet 1SivNhCB56wN_G8tFvHdxCbuKxt7ocDvXCinPhOA9qBc, gid 588349458).
 * The same sync runs hourly as the last step of the raw-material job; this is
 * the manual counterpart.
 *
 * Dry-run by default. Pass `--apply` to write.
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `\n=== SYNC RM DRAWINGS [${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}] ===\n`,
  );

  const r = await syncRmDrawings({ dryRun: !APPLY });
  if (r.columnMissing) {
    console.log(
      "[rm-drawings] RawMaterial.drawingUrl is not deployed yet (run db:deploy) - every current value was read as blank.",
    );
  }
  console.log(
    `[rm-drawings] sheet codes=${r.sheetCodes} withLink=${r.withLink} matchedRows=${r.matched} ` +
      `${APPLY ? "updated" : "wouldUpdate"}=${r.updated} notInRm=${r.notInRm.length}`,
  );
  if (r.notInRm.length) console.log(`[rm-drawings] codes with a drawing but no RawMaterial row: ${r.notInRm.join(", ")}`);
  r.samples.forEach((s) => console.log(`  ${s}`));
}

main()
  .catch((err) => {
    console.error("Sync RM drawings failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
