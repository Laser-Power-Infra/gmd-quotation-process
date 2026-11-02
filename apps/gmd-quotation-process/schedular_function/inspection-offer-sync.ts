/**
 * Contract Review step 5 — INSPECTION OFFER DUMP -> InspectionOffer + draft
 * InspectionReport.
 *
 * One `InspectionOffer` row per offer VRNO, item lines kept in `lines`. An
 * existing offer has its sheet fields refreshed when they differ; its report is
 * never touched. A VRNO not yet in the table is created together with a draft
 * report (`buildDraftReport`) filled from ContractReview (tender DB, joined on
 * CONTRACT_VRNO = mcNo + ITEM_CODE, as step 4 does) and the local ACC_MASTER
 * copy for the client name. Nothing is ever deleted.
 *
 * Runs after step 4 so the ContractReview rows it reads are this hour's.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  cell,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";
import { normalizeKey } from "@/lib/gmd_lib/ic-dump-merge";
import { getAccNameMap } from "@/lib/accMasterLookup";
import {
  IC_DUMP_COLUMNS,
  buildDraftReport,
  groupOfferRows,
  type ContractReviewSource,
  type OfferLine,
} from "@/lib/inspectionReport";

/** "INSPECTION OFFER DUMP" tab of the BOM MAST ERP workbook. */
const IC_DUMP_GID = 148043829;

export type InspectionOfferSyncResult = {
  tabTitle: string;
  sheetRows: number;
  offers: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Offers that threw on write; the run continues. */
  failed: number;
  dryRun: boolean;
  elapsedMs: number;
};

export type InspectionOfferSyncOptions = { dryRun?: boolean };

// jsonb does not keep key order, so compare in column order.
const linesKey = (ls: unknown) =>
  JSON.stringify(
    (Array.isArray(ls) ? (ls as Partial<OfferLine>[]) : []).map((l) =>
      IC_DUMP_COLUMNS.map((c) => l[c] ?? ""),
    ),
  );

export async function runInspectionOfferSync(
  options: InspectionOfferSyncOptions = {},
): Promise<InspectionOfferSyncResult> {
  const { dryRun = false } = options;
  const startedAt = Date.now();

  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    IC_DUMP_GID,
  );
  // Throws on a missing column, so a renamed header cannot shift the mapping.
  const idx = requireColumns(headers, [...IC_DUMP_COLUMNS], tabTitle);
  const lines = rows
    .filter((r) => r.some((c) => c !== ""))
    .map(
      (r) =>
        Object.fromEntries(IC_DUMP_COLUMNS.map((c, i) => [c, cell(r, idx[i])])) as OfferLine,
    );
  const offers = groupOfferRows(lines);

  const existing = new Map(
    (
      await prisma.inspectionOffer.findMany({
        select: { vrno: true, vrDate: true, accCode: true, contractVrno: true, lines: true },
      })
    ).map((o) => [o.vrno, o]),
  );

  const fresh = [...offers.values()].filter((o) => !existing.has(o.vrno));
  const crByKey = new Map<string, ContractReviewSource>();
  let accNames = new Map<string, string>();
  if (fresh.length > 0) {
    const crRows = await tenderPrisma.contractReview.findMany({
      select: {
        contractNo: true, mcNo: true, itemCode: true, itemName: true, size: true,
        pnRating: true, orderQty: true, icQty: true, poNo: true, dateOfContract: true,
        projectReference: true, utility: true, state: true, partyNameDump: true,
      },
      orderBy: { syncedAt: "desc" },
    });
    for (const r of crRows) {
      const key = `${normalizeKey(r.mcNo)}||${normalizeKey(r.itemCode)}`;
      if (!crByKey.has(key)) crByKey.set(key, r); // newest sync wins
    }
    accNames = await getAccNameMap();
  }
  const crFor = (mcNo: string, itemCode: string) =>
    crByKey.get(`${normalizeKey(mcNo)}||${normalizeKey(itemCode)}`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const offer of offers.values()) {
    const fields = {
      vrDate: offer.vrDate,
      accCode: offer.accCode,
      contractVrno: offer.contractVrno,
      lines: offer.lines,
    };
    const prev = existing.get(offer.vrno);
    try {
      if (!prev) {
        if (!dryRun) {
          const data = buildDraftReport(offer, crFor, accNames.get(normalizeKey(offer.accCode)));
          await prisma.inspectionOffer.create({
            data: { vrno: offer.vrno, ...fields, report: { create: { data } } },
          });
        }
        created++;
      } else if (
        prev.vrDate !== fields.vrDate ||
        prev.accCode !== fields.accCode ||
        prev.contractVrno !== fields.contractVrno ||
        linesKey(prev.lines) !== linesKey(fields.lines)
      ) {
        if (!dryRun) {
          await prisma.inspectionOffer.update({
            where: { vrno: offer.vrno },
            data: { ...fields, syncedAt: new Date() },
          });
        }
        updated++;
      } else {
        unchanged++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[inspection-offer] ${offer.vrno} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[scheduler] inspection-offer ${dryRun ? "DRY RUN" : "APPLY"} tab=${tabTitle} rows=${lines.length} ` +
      `offers=${offers.size} created=${created} updated=${updated} unchanged=${unchanged} failed=${failed} ${elapsedMs}ms`,
  );

  return {
    tabTitle,
    sheetRows: lines.length,
    offers: offers.size,
    created,
    updated,
    unchanged,
    failed,
    dryRun,
    elapsedMs,
  };
}
