/**
 * Contract Review step 6 — PROD ENTRY DUMP -> ContractReview.prodEntryDate.
 *
 * The ERP's production entries (EXECUTION TRACKING workbook, `prodEntryDumpGid()`), folded to the
 * latest VRDATE per production order + item (`latestProdEntryDates`) and written to the rows whose
 * productionOrderNumber + itemCode match. A row with no dated entry is left alone, so a blank
 * sheet date never clears a stored one. One tab read and one ContractReview read per run.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { readSheetTabByGid, requireColumns } from "@/lib/gmd_lib/bomMastErp";
import {
  executionTrackingSpreadsheetId,
  prodEntryDumpGid,
} from "@/lib/gmd_lib/execution-tracking-columns";
import { latestProdEntryDates, prodEntryKey } from "@/lib/contractReviewLinks";

const WRITE_BATCH = 200;

export type ProdEntrySyncResult = {
  tabTitle: string;
  sheetRows: number;
  /** Production order + item pairs with a readable entry date. */
  entries: number;
  /** Sheet rows with a blank prod order / item or a blank or unreadable VRDATE. */
  skippedRows: number;
  rowsToUpdate: number;
  /** Rows actually written (0 on a dry run). */
  written: number;
  /** Rows in batches that threw; the run continues. */
  failedWrites: number;
  dryRun: boolean;
  elapsedMs: number;
};

export async function runProdEntrySync(
  options: { dryRun?: boolean } = {},
): Promise<ProdEntrySyncResult> {
  const { dryRun = false } = options;
  const startedAt = Date.now();

  const { tabTitle, headers, rows } = await readSheetTabByGid(
    executionTrackingSpreadsheetId(),
    prodEntryDumpGid(),
  );
  // Throws on a renamed column, so the step fails loudly instead of silently writing nothing.
  const [orderIdx, itemIdx, dateIdx] = requireColumns(
    headers,
    ["ORDER_VRNO", "ITEM_CODE", "VRDATE"],
    tabTitle,
  );
  const { latest, skipped } = latestProdEntryDates({ rows, orderIdx, itemIdx, dateIdx });

  const crRows = await tenderPrisma.contractReview.findMany({
    select: { id: true, productionOrderNumber: true, itemCode: true, prodEntryDate: true },
  });
  const updates = crRows.flatMap((r) => {
    const day = latest.get(prodEntryKey(r.productionOrderNumber, r.itemCode));
    return day && day !== r.prodEntryDate ? [{ id: r.id, day }] : [];
  });

  let written = 0;
  let failedWrites = 0;
  if (!dryRun) {
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const batch = updates.slice(i, i + WRITE_BATCH);
      try {
        await tenderPrisma.$transaction(
          batch.map((u) =>
            tenderPrisma.contractReview.update({
              where: { id: u.id },
              data: { prodEntryDate: u.day },
            }),
          ),
        );
        written += batch.length;
      } catch (err) {
        failedWrites += batch.length;
        console.error(
          `[prod-entry] batch failed (${batch.length} rows, offset ${i}) err=${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[scheduler] prod-entry ${dryRun ? "DRY RUN" : "APPLY"} tab=${tabTitle} rows=${rows.length} ` +
      `skipped=${skipped} entries=${latest.size} toUpdate=${updates.length} written=${written} ` +
      `failedWrites=${failedWrites} ${elapsedMs}ms`,
  );

  return {
    tabTitle,
    sheetRows: rows.length,
    entries: latest.size,
    skippedRows: skipped,
    rowsToUpdate: updates.length,
    written,
    failedWrites,
    dryRun,
    elapsedMs,
  };
}
