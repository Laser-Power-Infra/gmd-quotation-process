import "dotenv/config";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  BOM_MAST_ERP_GID,
  readSheetTabByGid,
} from "../lib/gmd_lib/bomMastErp";

// Usage: tsx scripts/print-bom-mast-headers.ts [gid] [spreadsheetId]
// An unknown gid (e.g. -1) errors with the full tab list, which is how to find
// a tab's gid (PURCHASE ORD, GRN, ...) before wiring it.
async function main() {
  const gid = Number(process.argv[2] ?? BOM_MAST_ERP_GID);
  const spreadsheetId = process.argv[3] ?? BOM_MAST_ERP_SPREADSHEET_ID;
  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, gid);
  console.log(`spreadsheet: ${spreadsheetId}`);
  console.log(`tab: ${tabTitle} (gid ${gid})`);
  console.log(`data rows: ${rows.length}`);
  console.log(`headers (${headers.length}):`);
  headers.forEach((h, i) => console.log(`  ${String(i).padStart(3)}: ${h}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
