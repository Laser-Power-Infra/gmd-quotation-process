/**
 * INSPECTION OFFER DUMP -> InspectionOffer + auto Draft Inspection Report.
 *
 * One InspectionOffer per offer VRNO; a draft report is created when a new VRNO
 * appears and refreshed on later runs only while its status is still "Draft".
 * Needs migration 20261102091000_inspection_offer_draft deployed (db:deploy) for --apply.
 * The dry run only reads, and works before the migration.
 *
 *   npx tsx scripts/sync-inspection-offers.ts          # dry run
 *   npx tsx scripts/sync-inspection-offers.ts --apply  # write
 */
import "dotenv/config";
import { prisma as tender } from "@gmd/db-tender";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";
import { BOM_MAST_ERP_SPREADSHEET_ID } from "../lib/gmd_lib/bomMastErp";
import { buildDraft, groupOffers } from "../lib/inspectionOffer";

const IC_DUMP_GID = 148043829;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== INSPECTION OFFERS -> drafts (${apply ? "APPLY" : "DRY-RUN"}) ===`);
  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BOM_MAST_ERP_SPREADSHEET_ID });
  const title = meta.data.sheets?.find((s) => s.properties?.sheetId === IC_DUMP_GID)?.properties?.title;
  if (!title) throw new Error(`Tab gid ${IC_DUMP_GID} not found`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BOM_MAST_ERP_SPREADSHEET_ID,
    range: `'${title}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  // Only offers not yet inspected: the draft exists before inspection.
  const offers = new Map([...groupOffers(res.data.values ?? [])].filter(([, rows]) => !rows[0].INSPE_VRNO));
  const contract = await tender.contractReview.findMany({
    select: { mcNo: true, itemCode: true, itemName: true, size: true, pnRating: true, orderQty: true, mcQty: true, balanceMc: true, dateOfContract: true, contractNo: true, partyNameDump: true, projectReference: true },
  });

  let existing = new Map<string, string>();
  try {
    existing = new Map((await tender.inspectionReportDraft.findMany({ select: { offerVrno: true, status: true } })).map((d) => [d.offerVrno, d.status]));
  } catch {
    console.log("(InspectionReportDraft table not deployed yet: treating every offer as new)");
  }

  let created = 0, refreshed = 0, locked = 0, withIssues = 0;
  for (const [vrno, rows] of offers) {
    const d = buildDraft(vrno, rows, contract);
    const status = existing.get(vrno);
    if (status && status !== "Draft") { locked++; continue; }
    status ? refreshed++ : created++;
    if (d.issues.length > 1) withIssues++;
    if (!apply) continue;
    const first = rows[0];
    await tender.inspectionOffer.upsert({
      where: { vrno },
      create: { vrno, vrdate: first.VRDATE, contractNo: first.CONTRACT_VRNO, inspeDate: first.INSPE_DATE, rows },
      update: { vrdate: first.VRDATE, contractNo: first.CONTRACT_VRNO, inspeDate: first.INSPE_DATE, rows },
    });
    await tender.inspectionReportDraft.upsert({
      where: { offerVrno: vrno },
      create: { offerVrno: vrno, header: d.header, items: d.items, issues: d.issues },
      update: { header: d.header, items: d.items, issues: d.issues },
    });
  }
  console.log(`offers=${offers.size} newDrafts=${created} refreshed=${refreshed} lockedBeyondDraft=${locked} withDataIssues=${withIssues}`);
  const wanted = ["SD26Y-00058", "SD26Y-00059", "SD26Y-00082", "SD25Y-00209", "SD25Y-00012"];
  for (const sd of wanted) {
    const mc = new Set(contract.filter((c) => c.contractNo.toUpperCase() === sd).map((c) => String(c.mcNo).toUpperCase()));
    const hit = [...offers].filter(([, r]) => mc.has(r[0].CONTRACT_VRNO.toUpperCase())).map(([v]) => v);
    console.log(`  back-fill ${sd} (MC ${[...mc].join(",") || "not in Contract Review"}): ${hit.join(", ") || "no uninspected offer"}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
