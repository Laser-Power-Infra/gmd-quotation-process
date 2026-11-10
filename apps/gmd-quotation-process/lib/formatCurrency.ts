export { formatIndianNumber } from "@gmd/ui/lib/format";

/**
 * Strip grouping symbols from a user-entered value so it can be parsed as a number.
 */
export function cleanNumberInput(value: string): string {
  return value.replace(/[,\s₹]/g, "").trim();
}

/**
 * Compare a cleaned user-entered value against the raw stored value numerically.
 * Avoids spurious saves when formatting differences (e.g. "1230.00" vs "1,230") are
 * the only change.
 */
export function hasNumberChanged(
  entered: string,
  raw: number | string | null | undefined
): boolean {
  const next = parseFloat(entered);
  if (raw === null || raw === undefined || raw === "") {
    return !Number.isNaN(next);
  }
  const prev = parseFloat(String(raw).replace(/,/g, "").trim());
  if (Number.isNaN(prev) && Number.isNaN(next)) return false;
  if (Number.isNaN(prev) || Number.isNaN(next)) return true;
  return prev !== next;
}
