export const VERIFY_BOM_HEADERS = [
  "BOM ID",
  "ITEM CODE",
  "RM ITEM CODE",
  "BOM ID TYPE",
  "BOM ITEM QTY",
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
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
    rmItemCode: getRequired(2),
    bomIdType: getVal(3),
    bomItemQty: getVal(4),
    syncedAt,
  };
}

export function dbVerifyBomToRow(item: {
  bomId: string | null;
  itemCode: string | null;
  rmItemCode: string | null;
  bomIdType: string | null;
  bomItemQty: string | null;
}): unknown[] {
  return [
    item.bomId,
    item.itemCode,
    item.rmItemCode,
    item.bomIdType,
    item.bomItemQty,
  ];
}

export const VERIFY_BOM_HEADER_TO_DB_FIELD: Record<string, string> = {
  "BOM ID": "bomId",
  "ITEM CODE": "itemCode",
  "RM ITEM CODE": "rmItemCode",
  "BOM ID TYPE": "bomIdType",
  "BOM ITEM QTY": "bomItemQty",
};
