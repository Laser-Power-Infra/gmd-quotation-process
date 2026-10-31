import type { VariantMetrics } from "./indentListingMetrics";

// Row layout from `lib/indentListingRead.ts`: [3] MC RECEIVED/PENDING, [5..8] V1..V4 balance.
const STATUS_IDX = 3;
const V_VALUE_IDXS = [5, 6, 7, 8];

export interface IndentSummary {
  total: number;
  received: number;
  pending: number;
  shortage: number;
}

function toNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Short = some variant's balance (V1..V4 value) is above that variant's stock.
 * A variant with no known stock (no RM code resolved) is not counted as short.
 */
export function isShortageRow(row: unknown[], metrics?: VariantMetrics[]): boolean {
  return V_VALUE_IDXS.some((idx, slot) => {
    const need = toNumber(row[idx]);
    const stock = toNumber(metrics?.[slot]?.stock) ?? 0; // blank stock = 0
    return need !== null && need > 0 && need > stock;
  });
}

/** Tile counts for the Indent Checking page, over the rows the table currently shows. */
export function summarizeIndentRows(
  rows: unknown[][],
  getMetrics: (row: unknown[]) => VariantMetrics[] | undefined,
): IndentSummary {
  const summary: IndentSummary = { total: rows.length, received: 0, pending: 0, shortage: 0 };
  for (const row of rows) {
    const status = String(row[STATUS_IDX] ?? "").trim().toUpperCase();
    if (status === "RECEIVED") summary.received++;
    else if (status === "PENDING") summary.pending++;
    if (isShortageRow(row, getMetrics(row))) summary.shortage++;
  }
  return summary;
}
