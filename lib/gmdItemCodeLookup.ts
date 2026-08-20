import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { getOAuthClient } from "@/lib/googleAuth";

const SHEET_SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502;
const STALENESS_HOURS = 24;

function getAuth() {
  return getOAuthClient();
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function syncGmdItemCodes(): Promise<{ count: number }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID
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
    return { count: 0 };
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const colIdx = (name: string) => normalized.findIndex((h) => h === name);
  const itemCodeIdx = colIdx("CODE FOR THE ITEM");
  const itemTypeIdx = colIdx("ITEM TYPE");
  const mocIdx = colIdx("MOC");
  const operationIdx = colIdx("OPERATION");
  const sizeIdx = colIdx("SIZE");
  const pnGmdIdx = colIdx("PN-GMD");

  if (itemCodeIdx === -1 || itemTypeIdx === -1 || mocIdx === -1 || operationIdx === -1 || sizeIdx === -1 || pnGmdIdx === -1) {
    throw new Error(`Required columns not found. Found: ${JSON.stringify({ itemCodeIdx, itemTypeIdx, mocIdx, operationIdx, sizeIdx, pnGmdIdx })}`);
  }

  const dataRows = allRows.slice(1).filter((r) => r.some((c) => c !== null && c !== ""));
  const syncedAt = new Date();

  const dbRows = dataRows.map((row) => ({
    itemCode: String(row[itemCodeIdx] ?? "").trim(),
    itemType: String(row[itemTypeIdx] ?? "").trim(),
    moc: String(row[mocIdx] ?? "").trim(),
    operation: String(row[operationIdx] ?? "").trim(),
    size: String(row[sizeIdx] ?? "").trim(),
    pnGmd: String(row[pnGmdIdx] ?? "").trim(),
    syncedAt,
  })).filter((r) => r.itemCode && r.itemType && r.moc && r.operation && r.size && r.pnGmd);

  await prisma.$transaction([
    prisma.gmdItemCode.deleteMany(),
    prisma.gmdItemCode.createMany({ data: dbRows, skipDuplicates: true }),
  ]);

  return { count: dbRows.length };
}

export async function backfillExistingItems(): Promise<{ total: number; filled: number }> {
  const items = await prisma.enquiryItem.findMany({
    where: {
      erpItemCode: null,
      itemType: { not: null },
      moc: { not: null },
      size: { not: null },
      pnRating: { not: null },
      operationType: { not: null },
    },
    select: {
      id: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
    },
  });

  if (items.length === 0) return { total: 0, filled: 0 };

  let filled = 0;
  for (const item of items) {
    const code = await lookupItemCodeGated({
      itemType: item.itemType!,
      moc: item.moc!,
      operationType: item.operationType!,
      size: item.size!,
      pnRating: item.pnRating!,
    });
    if (code) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { erpItemCode: code },
      });
      filled++;
    }
  }

  return { total: items.length, filled };
}

async function ensureFreshData(): Promise<void> {
  const count = await prisma.gmdItemCode.count();
  if (count === 0) {
    // console.log("[GmdItemCode] Table empty — syncing from sheet...");
    const { count: syncCount } = await syncGmdItemCodes();
    console.log(`[GmdItemCode] Synced ${syncCount} rows`);
    const backfill = await backfillExistingItems();
    console.log(`[GmdItemCode] Backfilled ${backfill.filled}/${backfill.total} existing items`);
    return;
  }

  const latest = await prisma.gmdItemCode.findFirst({ orderBy: { syncedAt: "desc" } });
  if (latest) {
    const hoursSince = (Date.now() - latest.syncedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > STALENESS_HOURS) {
      console.log(`[GmdItemCode] Data stale (${hoursSince.toFixed(1)}h old) — re-syncing...`);
      const { count: syncCount } = await syncGmdItemCodes();
      console.log(`[GmdItemCode] Re-synced ${syncCount} rows`);
      const backfill = await backfillExistingItems();
      console.log(`[GmdItemCode] Re-backfilled ${backfill.filled}/${backfill.total} items`);
    }
  }
}

async function lookupItemCodeDirect(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  const match = await prisma.gmdItemCode.findUnique({
    where: {
      itemType_moc_operation_size_pnGmd: {
        itemType: params.itemType,
        moc: params.moc,
        operation: params.operationType,
        size: params.size,
        pnGmd: params.pnRating,
      },
    },
    select: { itemCode: true },
  });
  return match?.itemCode ?? null;
}

export async function lookupItemCodeGated(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  await ensureFreshData();
  const code = await lookupItemCodeDirect(params);
  if (!code) return null;
  // BOM gate: only return code if it has a DIRECT M2M entry in the same sheet
  try {
    const { hasDirectM2M } = await import("@/lib/gmdBomCostLookup");
    const hasBom = await hasDirectM2M(code);
    if (!hasBom) return null;
  } catch {
    // If BOM check fails (sheet unreachable), fall back to no-gate behavior to not block UI
    // But log for visibility
    console.warn(`[GmdItemCode] BOM gate check failed for ${code}, allowing code anyway`);
  }
  return code;
}

export async function lookupItemCode(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  await ensureFreshData();
  return lookupItemCodeDirect(params);
}

/**
 * Lookup and persist item code with optional BOM gate and force recompute.
 * - bomGate: if true, code is only set if it has DIRECT M2M BOM entry
 * - force: if true, recompute even when erpItemCode already exists (used for derived-field cascade)
 */
export async function lookupAndSetItemCode(
  itemId: string,
  opts?: { bomGate?: boolean; force?: boolean }
): Promise<string | null> {
  const bomGate = opts?.bomGate ?? true;
  const force = opts?.force ?? false;
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
      erpItemCode: true,
    },
  });
  if (!item) return null;
  if (item.erpItemCode && !force) return item.erpItemCode;
  if (!item.itemType || !item.moc || !item.size || !item.pnRating || !item.operationType) return null;

  const code = bomGate
    ? await lookupItemCodeGated({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      })
    : await lookupItemCode({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      });

  if (code) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: code },
    });
  } else if (force && item.erpItemCode && bomGate) {
    // If force recompute yields null (no match or no BOM), clear stale code only when bomGate forces a gate miss
    // But per requirement, we do NOT auto-clear unless explicitly desired — keep old unless caller wants clear
    // For now, if gated lookup returns null and we were forced, clear the stale code
    // This ensures changing derived fields to a combo without BOM blanks the code
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: null },
    });
  }

  return code;
}

/**
 * Recompute item code from given field values (after an edit) with BOM gate.
 * Returns { oldCode, newCode, changed }
 */
export async function recomputeItemCodeForValues(
  itemId: string,
  values: { itemType: string | null; moc: string | null; size: string | null; pnRating: string | null; operationType: string | null },
  oldCode: string | null
): Promise<{ oldCode: string | null; newCode: string | null; changed: boolean }> {
  if (!values.itemType || !values.moc || !values.size || !values.pnRating || !values.operationType) {
    return { oldCode, newCode: null, changed: oldCode !== null };
  }
  const newCode = await lookupItemCodeGated({
    itemType: values.itemType,
    moc: values.moc,
    operationType: values.operationType,
    size: values.size,
    pnRating: values.pnRating,
  });
  // Persist if changed
  if (newCode !== oldCode) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: newCode },
    });
  }
  return { oldCode, newCode, changed: newCode !== oldCode };
}
