export const VERIFY_BOM_HEADERS = [
  "BOM ID",
  "ITEM CODE",
  "ITEM NAME",
  "ITEM SCHEDULE NAME",
  "RM ITEM CODE",
  "RM ITEM NAME",
  "BOM ID TYPE",
  "BOM ITEM QTY",
  "USE/NO USE",
  "AVAILABLE STOCK",
  "COST",
  "ITEM TYPE",
  "MOC",
  "OPERATION",
  "SIZE",
  "NO",
  "PN-GMD",
  "CURRENT REQT",
  "NEW ITEM NAME",
  "DUPLICATE MERGER COUNT",
  "BOM NATURE",
  "CONSUMPTION-1",
  "CONSUMPTION 2",
  "CONSUMPTION 3",
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/[\s_]+/g, " ").trim();
}

export function findVerifyBomColumnIndex(
  sheetHeaders: string[],
  header: string,
): number {
  const normalized = sheetHeaders.map(normalizeHeader);
  return normalized.findIndex((h) => h === normalizeHeader(header));
}

export function buildVerifyBomColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  return VERIFY_BOM_HEADERS.map((col) => {
    const target = normalizeHeader(col);
    return normalized.findIndex((h) => h === target);
  });
}

export function mapVerifyBomRow(
  row: unknown[],
  columnMap: number[],
  syncedAt: Date,
) {
  const getVal = (canonicalIdx: number): string | null => {
    const sheetIdx = columnMap[canonicalIdx];
    if (sheetIdx < 0) return null;
    const v = row[sheetIdx];
    return v != null && v !== "" ? String(v).trim() : null;
  };
  const getRequired = (canonicalIdx: number): string => {
    const sheetIdx = columnMap[canonicalIdx];
    return String(row[sheetIdx] ?? "").trim();
  };

  return {
    bomId: getRequired(0),
    itemCode: getRequired(1),
    itemName: getVal(2),
    itemScheduleName: getVal(3),
    rmItemCode: getRequired(4),
    rmItemName: getVal(5),
    bomIdType: getVal(6),
    bomItemQty: getVal(7),
    syncedAt,
  };
}

export function dbVerifyBomToRow(item: {
  bomId: string | null;
  itemCode: string | null;
  rmItemCode: string | null;
  bomIdType: string | null;
  bomItemQty: string | null;
  noUse: string | null;
  availableStock: string | null;
  cost: string | null;
  itemName: string | null;
  itemScheduleName: string | null;
  rmItemName: string | null;
  itemType: string | null;
  moc: string | null;
  operation: string | null;
  size: string | null;
  no: string | null;
  pnGmd: string | null;
  currentReqt: string | null;
  merged: string | null;
  duplicateMergerCount: string | null;
  bomNature: string | null;
  consumption1: string | null;
  consumption2: string | null;
  consumption3: string | null;
}): unknown[] {
  return [
    item.bomId,
    item.itemCode,
    item.itemName,
    item.itemScheduleName,
    item.rmItemCode,
    item.rmItemName,
    item.bomIdType,
    item.bomItemQty,
    item.noUse,
    item.availableStock,
    item.cost,
    item.itemType,
    item.moc,
    item.operation,
    item.size,
    item.no,
    item.pnGmd,
    item.currentReqt,
    item.merged,
    item.duplicateMergerCount,
    item.bomNature,
    item.consumption1,
    item.consumption2,
    item.consumption3,
  ];
}

export const VERIFY_BOM_HEADER_TO_DB_FIELD: Record<string, string> = {
  "BOM ID": "bomId",
  "ITEM CODE": "itemCode",
  "RM ITEM CODE": "rmItemCode",
  "BOM ID TYPE": "bomIdType",
  "BOM ITEM QTY": "bomItemQty",
  "USE/NO USE": "noUse",
  "AVAILABLE STOCK": "availableStock",
  "COST": "cost",
  "ITEM NAME": "itemName",
  "ITEM SCHEDULE NAME": "itemScheduleName",
  "RM ITEM NAME": "rmItemName",
  "ITEM TYPE": "itemType",
  "MOC": "moc",
  "OPERATION": "operation",
  "SIZE": "size",
  "NO": "no",
  "PN-GMD": "pnGmd",
  "CURRENT REQT": "currentReqt",
  "NEW ITEM NAME": "merged",
  "DUPLICATE MERGER COUNT": "duplicateMergerCount",
  "BOM NATURE": "bomNature",
  "CONSUMPTION-1": "consumption1",
  "CONSUMPTION 2": "consumption2",
  "CONSUMPTION 3": "consumption3",
};
