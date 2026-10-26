import { parseGmdDate } from "@gmd/ui/lib/dateParse";

// Cell comparators shared by GMDUpdateTable's client-side sort and by server
// pipelines that sort before paging, so both order rows identically.

export function compareDates(aVal: unknown, bVal: unknown, dir: number): number {
  const aStr = String(aVal ?? "").trim();
  const bStr = String(bVal ?? "").trim();
  const aD = aStr ? parseGmdDate(aStr) : null;
  const bD = bStr ? parseGmdDate(bStr) : null;
  const aT = aD ? aD.getTime() : null;
  const bT = bD ? bD.getTime() : null;
  const aNull = aT === null || isNaN(aT as number);
  const bNull = bT === null || isNaN(bT as number);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (aT === bT) return 0;
  return (aT! < bT! ? -1 : 1) * dir;
}

export function cellCompare(
  aVal: unknown,
  bVal: unknown,
  dir: number,
  numericStrings = false,
): number {
  if (numericStrings) {
    const aNumeric = parseSortNumber(aVal);
    const bNumeric = parseSortNumber(bVal);
    if (aNumeric !== null && bNumeric !== null) {
      if (aNumeric === bNumeric) return 0;
      return (aNumeric < bNumeric ? -1 : 1) * dir;
    }
  }
  const aNum = typeof aVal === "number" ? aVal : NaN;
  const bNum = typeof bVal === "number" ? bVal : NaN;
  if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * dir;
  const aKey = isNaN(aNum) ? String(aVal ?? "").toLowerCase() : "";
  const bKey = isNaN(bNum) ? String(bVal ?? "").toLowerCase() : "";
  const aNull = aKey === "" && isNaN(aNum);
  const bNull = bKey === "" && isNaN(bNum);
  if (aNull && bNull) return 0;
  if (aNull) return dir;
  if (bNull) return -dir;
  return aKey.localeCompare(bKey, undefined, { numeric: true }) * dir;
}

/**
 * Strict numeric parse used by the typed (Contract Review) sort. Handles sheet
 * number strings with thousands separators, a trailing percent, currency
 * symbols, and the literal "Infinity". Returns null for anything that is not a
 * pure number, so text columns (e.g. "PN-10/16") keep their natural ordering.
 */
export function parseSortNumber(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : Number.isNaN(value) ? null : value;
  const s = String(value ?? "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "infinity" || low === "+infinity") return Infinity;
  if (low === "-infinity") return -Infinity;
  const normalised = s
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[$₹€£]/g, "")
    .trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(normalised)) return null;
  const n = Number(normalised);
  return Number.isNaN(n) ? null : n;
}
