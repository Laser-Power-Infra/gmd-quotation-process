import "dotenv/config";
import { google } from "googleapis";
import { getOAuthClient } from "../lib/googleAuth";
import { prisma } from "../lib/prisma";
import { getBomUseStatusBatch } from "../lib/verifyBomLookup";

const SPREADSHEET_ID = "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";
const SHEET_GID = 1180547059;

const APPLY = process.argv.includes("--apply");

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/_+/g, " ");
}

function isToDateHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return /^TO\s*DATE$/.test(n) || /TO.*DATE/.test(n);
}

function getAuth() {
  return getOAuthClient();
}

type SheetRow = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  toDate: string;
};

async function fetchSheetRows(): Promise<{
  rows: SheetRow[];
  toDateHeader: string | null;
}> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(
      `Sheet with gid ${SHEET_GID} not found in spreadsheet ${SPREADSHEET_ID}`,
    );
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    return { rows: [], toDateHeader: null };
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const bomIdIdx = normalized.findIndex((h) => h === "BOM ID");
  const itemCodeIdx = normalized.findIndex((h) => h === "ITEM CODE");
  const rmItemCodeIdx = normalized.findIndex((h) => h === "RM ITEM CODE");
  const toDateIdx = normalized.findIndex(isToDateHeader);

  if (bomIdIdx === -1 || itemCodeIdx === -1 || rmItemCodeIdx === -1) {
    throw new Error(
      `Sheet "${tabTitle}" missing required column(s): ` +
        `${bomIdIdx === -1 ? "BOM ID " : ""}${
          itemCodeIdx === -1 ? "ITEM CODE "
          : ""
        }${rmItemCodeIdx === -1 ? "RM ITEM CODE" : ""}`.trim(),
    );
  }

  const getVal = (row: unknown[], idx: number): string =>
    idx >= 0 && row[idx] != null && String(row[idx]).trim() !== ""
      ? String(row[idx]).trim()
      : "";

  const rows: SheetRow[] = [];
  for (const row of allRows.slice(1)) {
    if (!row.some((c) => c !== null && c !== "")) continue;
    const bomId = getVal(row, bomIdIdx);
    const itemCode = getVal(row, itemCodeIdx);
    const rmItemCode = getVal(row, rmItemCodeIdx);
    const toDate = toDateIdx >= 0 ? getVal(row, toDateIdx) : "";
    if (!bomId || !itemCode || !rmItemCode) continue;
    rows.push({ bomId, itemCode, rmItemCode, toDate });
  }

  return { rows, toDateHeader: toDateIdx >= 0 ? headers[toDateIdx] : null };
}

function makeKey(bomId: string, itemCode: string, rmItemCode: string): string {
  return `${bomId}||${itemCode}||${rmItemCode}`;
}

async function main() {
  console.log(
    `\n=== SYNC BOM MAST ERP INTO VerifyBom + MARK TO_DATE AS NO USE [${APPLY ? "APPLY MODE" : "DRY RUN"}] ===\n`,
  );

  const { rows, toDateHeader } = await fetchSheetRows();
  console.log(`Source: spreadsheet ${SPREADSHEET_ID}, gid ${SHEET_GID}`);
  console.log(`Detected TO_DATE column: ${toDateHeader ?? "<none>"}`);
  console.log(`Sheet rows (with BOM/ITEM/RM): ${rows.length}`);
  console.log(`Sheet rows with TO_DATE set   : ${rows.filter((r) => r.toDate).length}`);

  if (!toDateHeader) {
    console.warn("\n[!] No TO DATE/TO_DATE header found in sheet. Only sync will run.");
  }

  // ---- Phase 1: plan the sync (upsert by bomId+itemCode+rmItemCode) ----
  const dbBefore = await prisma.verifyBom.findMany({
    select: { id: true, bomId: true, itemCode: true, rmItemCode: true, noUse: true },
  });
  const dbKeyToId = new Map<string, string>();
  for (const r of dbBefore) {
    dbKeyToId.set(makeKey(r.bomId, r.itemCode, r.rmItemCode), r.id);
  }

  let toCreate = 0;
  let toUpdate = 0;
  let unchanged = 0;
  for (const r of rows) {
    const key = makeKey(r.bomId, r.itemCode, r.rmItemCode);
    if (dbKeyToId.has(key)) unchanged++;
    else toCreate++;
  }
  // Existing rows: only touch syncedAt (metadata preserved), so they count as "toUpdate"
  toUpdate = unchanged;
  console.log("\n=== SYNC PLAN (BOM MAST ERP -> VerifyBom) ===");
  console.log(`Rows already in DB (will refresh syncedAt) : ${toUpdate}`);
  console.log(`Rows NEW in sheet (will be created)         : ${toCreate}`);

  // ---- Phase 2: plan the marks (TO_DATE -> noUse="NO USE") ----
  const toDateByKey = new Map<string, string>();
  for (const r of rows) {
    if (r.toDate) toDateByKey.set(makeKey(r.bomId, r.itemCode, r.rmItemCode), r.toDate);
  }

  const markTargets: {
    id: string | null;
    bomId: string;
    itemCode: string;
    rmItemCode: string;
    oldNoUse: string | null;
    toDate: string;
    new: boolean;
  }[] = [];
let alreadyNoUse = 0;

  for (const r of rows) {
    const key = makeKey(r.bomId, r.itemCode, r.rmItemCode);
    const toDate = toDateByKey.get(key);
    if (!toDate) continue;
    const existingId = dbKeyToId.get(key) ?? null;
    const oldNoUse = existingId
      ? (dbBefore.find((x) => x.id === existingId)?.noUse ?? null)
      : null;
    if (oldNoUse === "NO USE") {
      alreadyNoUse++;
      continue;
    }
    markTargets.push({
      id: existingId,
      bomId: r.bomId,
      itemCode: r.itemCode,
      rmItemCode: r.rmItemCode,
      oldNoUse,
      toDate,
      new: !existingId,
    });
  }

  console.log("\n--- PREVIEW OF ROWS TO MARK NO USE (first 40 shown) ---");
  console.log(
    "BOM ID".padEnd(16) +
      "| ITEM CODE".padEnd(16) +
      "| RM ITEM CODE".padEnd(18) +
      "| TYPE".padEnd(10) +
      "| CURRENT".padEnd(12) +
      "| TO_DATE",
  );
  console.log("-".repeat(85));

  markTargets.slice(0, 40).forEach((u) => {
    console.log(
      u.bomId.padEnd(16) +
        `| ${u.itemCode}`.padEnd(16) +
        `| ${u.rmItemCode}`.padEnd(18) +
        `| ${u.new ? "NEW" : "EXISTING"}`.padEnd(10) +
        `| ${(u.oldNoUse || "<blank>").padEnd(10)}` +
        `| ${u.toDate}`,
    );
  });

  if (markTargets.length > 40) {
    console.log(`... and ${markTargets.length - 40} more rows to mark.`);
  }

  const newMarkTargets = markTargets.filter((u) => u.new).length;
  const existingMarkTargets = markTargets.length - newMarkTargets;

  console.log("\n=== MARK PLAN (TO_DATE -> NO USE) ===");
  console.log(`Rows to mark NO USE                  : ${markTargets.length}`);
  console.log(`  - existing DB rows (noUse flip)    : ${existingMarkTargets}`);
  console.log(`  - NEW rows (created as NO USE)     : ${newMarkTargets}`);
  console.log(`Rows already NO USE (skipped)        : ${alreadyNoUse}`);

  let wouldRevert = 0;
  let willStick = 0;
  const affectedBoms = [...new Set(markTargets.map((u) => u.bomId))];
  if (affectedBoms.length > 0) {
    const statusMap = await getBomUseStatusBatch(affectedBoms);
    for (const u of markTargets) {
      if (statusMap.get(u.bomId) === "NO USE") willStick++;
      else wouldRevert++;
    }
    console.log("\n--- Server-action conflict check (recomputeVerifyBomValues) ---");
    console.log(`Marked rows recompute keeps NO USE : ${willStick}`);
    console.log(`Marked rows server action REVERTS  : ${wouldRevert}`);
  }

  if (!APPLY) {
    console.log("\n[!] Dry run complete. No database records were modified.");
    console.log("    To apply these changes, run: npm run bom:mark-to-date:apply\n");
    return;
  }

  // ---- Apply: Phase 1 sync ----
  console.log("\nApplying sync (BOM MAST ERP -> VerifyBom)...");
  const chunkSize = 100;
  const syncedAt = new Date();
  let createdCount = 0;
  let refreshedCount = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.verifyBom.upsert({
          where: {
            bomId_itemCode_rmItemCode: {
              bomId: r.bomId,
              itemCode: r.itemCode,
              rmItemCode: r.rmItemCode,
            },
          },
          create: {
            bomId: r.bomId,
            itemCode: r.itemCode,
            rmItemCode: r.rmItemCode,
            syncedAt,
          },
          update: { syncedAt },
        }),
      ),
    );
    const createdInChunk = chunk.filter((r) => !dbKeyToId.has(makeKey(r.bomId, r.itemCode, r.rmItemCode))).length;
    createdCount += createdInChunk;
    refreshedCount += chunk.length - createdInChunk;
  }
  console.log(`Sync done. Created ${createdCount}, refreshed ${refreshedCount}.`);

  // ---- Apply: Phase 2 marks ----
  console.log("Applying marks (TO_DATE -> NO USE)...");
  let markedCount = 0;
  for (let i = 0; i < markTargets.length; i += chunkSize) {
    const chunk = markTargets.slice(i, i + chunkSize);
    const updates = chunk.map((u) => {
      if (u.new) {
        return prisma.verifyBom.upsert({
          where: {
            bomId_itemCode_rmItemCode: {
              bomId: u.bomId,
              itemCode: u.itemCode,
              rmItemCode: u.rmItemCode,
            },
          },
          create: {
            bomId: u.bomId,
            itemCode: u.itemCode,
            rmItemCode: u.rmItemCode,
            noUse: "NO USE",
            syncedAt: new Date(),
          },
          update: { noUse: "NO USE", syncedAt: new Date() },
        });
      }
      return prisma.verifyBom.update({
        where: { id: u.id! },
        data: { noUse: "NO USE", syncedAt: new Date() },
      });
    });
    await prisma.$transaction(updates);
    markedCount += chunk.length;
  }
  console.log(`Marked ${markedCount} rows as NO USE in VerifyBom!`);
}

main()
  .catch((e) => {
    console.error("Script failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());