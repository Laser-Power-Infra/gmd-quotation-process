import type { VariantMetrics } from "./indentListingMetrics";
import { valveTypesForIndentItem } from "./indentItemValveTypes";
import { RM_CODE_MATCH_BY_ITEM } from "./indentRmCodeResolver";

// Row layout from `lib/indentListingRead.ts`: [0] item, [2] PN, [3] MC RECEIVED/PENDING,
// [4] total, [5..8] V1..V4 balance, [13..16] V1..V4 RM code.
const STATUS_IDX = 3;
const TOTAL_IDX = 4;
const V_VALUE_IDXS = [5, 6, 7, 8];
const V_RM_IDXS = [13, 14, 15, 16];

export interface IndentSummary {
  total: number;
  received: number;
  pending: number;
  shortage: number;
  inputsMissing: number;
}

function toNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const text = (row: unknown[], idx: number) => String(row[idx] ?? "").trim();

/** Items whose RM code can be resolved or hand-picked (others have no RM master type yet). */
export function canPickRmCode(item: string): boolean {
  return item.toUpperCase() in RM_CODE_MATCH_BY_ITEM || valveTypesForIndentItem(item).length > 0;
}

/**
 * What a row still needs before it is complete (31 Oct UI review): a PN, a positive
 * total, a V1..V4 split covering the whole total, no negative V value, and an RM code
 * on every non-zero V slot (only for items that can get one). Empty = complete.
 */
export function missingInputs(row: unknown[]): string[] {
  const out: string[] = [];
  if (text(row, 2) === "") out.push("PN rating blank");
  const total = toNumber(row[TOTAL_IDX]);
  if (total === null || total <= 0) out.push(`Total qty ${total ?? "blank"}`);
  const values = V_VALUE_IDXS.map((idx) => toNumber(row[idx]));
  if (values.every((v) => v === null || v === 0)) out.push("No V1–V4 breakdown");
  else {
    const split = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    if (total !== null && total > 0 && split < total) out.push(`Only ${split} of ${total} split into V1–V4`);
    if (values.some((v) => v !== null && v < 0)) out.push("Negative V qty");
    if (canPickRmCode(text(row, 0))) {
      const noCode = values.flatMap((v, slot) => (v !== null && v > 0 && text(row, V_RM_IDXS[slot]) === "" ? [`V${slot + 1}`] : []));
      if (noCode.length > 0) out.push(`No RM code on ${noCode.join(", ")}`);
    }
  }
  return out;
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
  const summary: IndentSummary = { total: rows.length, received: 0, pending: 0, shortage: 0, inputsMissing: 0 };
  for (const row of rows) {
    const status = String(row[STATUS_IDX] ?? "").trim().toUpperCase();
    if (status === "RECEIVED") summary.received++;
    else if (status === "PENDING") summary.pending++;
    if (isShortageRow(row, getMetrics(row))) summary.shortage++;
    if (missingInputs(row).length > 0) summary.inputsMissing++;
  }
  return summary;
}
