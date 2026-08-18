import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";
import { getOAuthClient } from "../lib/googleAuth";
import { recalculateItem } from "../lib/costCalculator";

const SHEET_SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502; // GMD Item Creation Form

const DIRECT_M2M = "DIRECT M2M";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mon = months[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const day = parseInt(m[1], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (isNaN(day) || day < 1 || day > 31 || isNaN(year)) return null;
  return new Date(year, mon, day);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

async function fetchBomRows(): Promise<
  { itemCode: string; bomId: string | null; rmItemCode: string }[]
> {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Sheet with gid ${SHEET_GID} not found in spreadsheet`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    return [];
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const colFirst = (name: string) => normalized.indexOf(name);
  const colLast = (name: string) => normalized.lastIndexOf(name);

  const codeIdx = colFirst("CODE FOR THE ITEM");
  const itemTypeIdx = colLast("ITEM TYPE");
  const bomIdIdx = colFirst("BOM ID");
  const rmIdx = colFirst("CONSUMPTION-1");

  if (codeIdx === -1 || itemTypeIdx === -1 || bomIdIdx === -1 || rmIdx === -1) {
    throw new Error(
      `Required columns not found. Found indices: ${JSON.stringify({
        codeIdx, itemTypeIdx, bomIdIdx, rmIdx,
        headers: headers.map((h, i) => (h.trim() ? `${i}:${h}` : null)).filter(Boolean),
      })}`,
    );
  }

  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const seen = new Set<string>();
  const result: { itemCode: string; bomId: string | null; rmItemCode: string }[] = [];

  for (const row of dataRows) {
    if (String(row[itemTypeIdx] ?? "").trim().toUpperCase() !== DIRECT_M2M) continue;
    const itemCode = String(row[codeIdx] ?? "").trim();
    const rmItemCode = String(row[rmIdx] ?? "").trim();
    if (!itemCode || !rmItemCode) continue;
    if (seen.has(itemCode)) continue;
    seen.add(itemCode);

    const bomIdRaw = String(row[bomIdIdx] ?? "").trim();
    result.push({
      itemCode,
      bomId: bomIdRaw ? bomIdRaw : null,
      rmItemCode,
    });
  }

  return result;
}

async function buildCostMap(
  rmCodes: string[],
): Promise<Map<string, number>> {
  const costMap = new Map<string, number>();

  if (rmCodes.length === 0) return costMap;

  const rows = await prisma.supplyHistoryItem.findMany({
    where: { erpItemCode: { in: rmCodes } },
    select: {
      erpItemCode: true,
      quantity: true,
      value: true,
      date: true,
    },
  });

  const byCode = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.erpItemCode) continue;
    const list = byCode.get(row.erpItemCode) ?? [];
    list.push(row);
    byCode.set(row.erpItemCode, list);
  }

  for (const [code, list] of byCode) {
    let best: { date: Date | null; unitCost: number } | null = null;
    for (const row of list) {
      const qty = toNumber(row.quantity);
      const value = toNumber(row.value);
      if (qty === null || value === null || qty <= 0) continue;
      const unitCost = value / qty;
      const date = parseDate(row.date);
      if (
        best === null ||
        (date !== null && (best.date === null || date > best.date)) ||
        (date !== null && best.date !== null && date.getTime() === best.date.getTime() && unitCost > best.unitCost)
      ) {
        best = { date, unitCost };
      }
    }
    if (best !== null) {
      costMap.set(code, best.unitCost);
    }
  }

  return costMap;
}

async function main() {
  console.log("\n=== [BOM] UPDATE PRODUCT COST FROM BOM START ===\n");

  const bomRows = await fetchBomRows();
  console.log(`[BOM] Sheet DIRECT M2M rows with rm code: ${bomRows.length}`);

  const bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
  for (const r of bomRows) {
    bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
  }

  const rmCodes = [...new Set(bomRows.map((r) => r.rmItemCode))];
  console.log(`[BOM] Distinct RM codes: ${rmCodes.length}`);

  const costMap = await buildCostMap(rmCodes);
  console.log(`[BOM] RM codes with a computable cost: ${costMap.size}`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { in: [...bomMap.keys()] } },
    select: { id: true, erpItemCode: true, itemName: true, productCost: true },
  });
  console.log(`[BOM] EnquiryItems whose erpItemCode matched the sheet: ${items.length}`);

  let filled = 0;
  let bomOnly = 0;
  let skippedExisting = 0;
  let errored = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const bom = bomMap.get(item.erpItemCode!);
    if (!bom) continue;

    const cost = costMap.get(bom.rmItemCode);
    process.stdout.write(`\r[${i + 1}/${items.length}] ${item.itemName.substring(0, 50).padEnd(50)}`);

    try {
      const isBlank = item.productCost === null;

      if (isBlank && cost !== undefined && cost !== null) {
        await recalculateItem(item.id, { productCost: cost });
        filled++;
      } else if (isBlank) {
        bomOnly++;
      } else {
        skippedExisting++;
      }

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          bomId: bom.bomId,
          bomType: DIRECT_M2M,
          rmItemCode: bom.rmItemCode,
        },
      });
    } catch (err) {
      errored++;
      console.error(`\n  ✗ Failed for item ${item.id} (${item.erpItemCode}):`, (err as Error).message);
    }
  }

  console.log(`\n\n=== [BOM] DONE ===`);
  console.log(`[BOM] Blank productCost filled (with recompute): ${filled}`);
  console.log(`[BOM] BOM fields saved without cost: ${bomOnly}`);
  console.log(`[BOM] Skipped (productCost already set): ${skippedExisting}`);
  console.log(`[BOM] Errors: ${errored}\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
