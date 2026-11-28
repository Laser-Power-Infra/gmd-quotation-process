/**
 * Load Puja's CHINA LOT ALLOCATION tab (GMD CLIENTS WISE) into PurchaseAllocation.
 *
 *   pnpm --filter=gmd-quotation-process china-lots:load          # dry run: counts + unmatched.csv, reads only
 *   pnpm --filter=gmd-quotation-process china-lots:load --apply  # write (only after the dry-run counts were seen)
 *
 * Writes only through addPurchaseAllocation (capacity guard + log). Lots with no single purchase line are listed in
 * unmatched.csv, never loaded or guessed. Re-run is safe: a row already booked with the same qty counts as already loaded; a different qty on the same key is reported as a conflict.
 *
 * Env: STOCK_DATABASE_URL, Google OAuth (lib/googleAuth), optional CLIENTS_WISE_SPREADSHEET_ID.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sheets as googleSheets } from "@googleapis/sheets";
import { stockPrisma } from "@gmd/db-stock";
import { getOAuthClient } from "@/lib/googleAuth";
import { matchLots, parseLotRows } from "@/lib/chinaLotMatch";
import { applyLots } from "@/lib/chinaLotLoad";

const SPREADSHEET_ID = process.env.CLIENTS_WISE_SPREADSHEET_ID ?? "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE"; // GMD CLIENTS WISE
const TAB = "CHINA LOT ALLOCATION";
const OUT = "D:/gmd-quotation-process/.superpowers/sdd/2026-11-23-purchase-linked-allocation/unmatched.csv";
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const apply = process.argv.includes("--apply");
  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:N`, valueRenderOption: "FORMATTED_VALUE" });
  const rows = parseLotRows((res.data.values ?? []).map((r) => r.map(String)));
  const lines = await stockPrisma.purchaseOrderLine.findMany({ select: { poNo: true, poLineNo: true, itemCode: true, salesContract: true, partyRefNo: true } });
  const { matched, unmatched } = matchLots(rows, lines);

  const byReason = (r: string) => unmatched.filter((u) => u.reason === r).length;
  console.log(`[china-lots] rows read ${rows.length}, matched ${matched.length}, unmatched ${unmatched.length} (no purchase line ${byReason("no purchase line")}, ambiguous ${byReason("ambiguous")}, quantity not a plain number ${byReason("quantity not a plain number")})`);
  writeFileSync(OUT, ["contract,item,size,qty,lot,tina invoice,b/l,reason", ...unmatched.map(({ row: r, reason }) =>
    [r.contractNo, r.itemCode, r.size, r.qtyRaw, r.lot, r.tinaInvoiceNo, r.blStatus, reason].map(csv).join(","))].join("\n") + "\n");
  console.log(`[china-lots] unmatched list -> ${OUT}`);

  if (!apply) return console.log("[china-lots] dry run, nothing written. Re-run with --apply.");
  const { addPurchaseAllocation, DuplicatePurchaseAllocationError } = await import("@gmd/stock-allocation/server"); // lazy: the dry run needs only the stock DB client
  const existing = await stockPrisma.purchaseAllocation.findMany({ select: { poNo: true, poLineNo: true, contractNo: true, itemCode: true, qty: true } });
  const { loaded, alreadyLoaded, conflicts, failed } = await applyLots(matched, existing, ({ row: r, poNo, poLineNo }) =>
    addPurchaseAllocation({
      poNo, poLineNo, contractNo: r.contractNo, itemCode: r.itemCode, qty: r.qty, lot: r.lot, tinaInvoiceNo: r.tinaInvoiceNo,
      blNo: r.blStatus, eta: null, shipStatus: null, needsConfirmation: r.needsConfirmation, source: "sheet",
    }, "china-lots:load"), (e) => e instanceof DuplicatePurchaseAllocationError);
  for (const c of conflicts) console.warn(`[china-lots] CONFLICT ${c}`);
  for (const f of failed) console.error(`[china-lots] ${f}`);
  console.log(`[china-lots] loaded ${loaded}, already loaded ${alreadyLoaded}, conflicts ${conflicts.length}, failed ${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(`[china-lots] FAILED: ${e instanceof Error ? e.message : e}`); process.exit(1); }).finally(() => stockPrisma.$disconnect());
