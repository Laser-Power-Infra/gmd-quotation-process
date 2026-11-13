import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import type { TableSort } from "@gmd/ui/components/data-table/types";

// Cell comparators shared by GMDUpdateTable's client-side sort and by server
// pipelines that sort before paging, so both order rows identically.

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "number" ? Number.isNaN(v) : String(v).trim() === "");

/**
 * Sort for the plain tables behind a SortTh header. `value` reads a column from a row; keys in
 * `dateKeys` compare as GMD text dates, Date values by time. Blanks go last both ways, ties keep the incoming order,
 * and `rows` is never changed (no sort returns it as is).
 */
export function sortRows<Row>(
  rows: Row[],
  sort: TableSort | null,
  value: (row: Row, key: string) => unknown,
  dateKeys: readonly string[] = [],
): Row[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  const compare = dateKeys.includes(sort.key) ? compareDates : cellCompare;
  // A Date compares by its time; as text it would order by weekday name.
  const at = (row: Row) => {
    const v = value(row, sort.key);
    return v instanceof Date ? v.getTime() : v;
  };
  return [...rows].sort((a, b) => {
    const av = at(a);
    const bv = at(b);
    const aBlank = isBlank(av);
    const bBlank = isBlank(bv);
    if (aBlank || bBlank) return Number(aBlank) - Number(bBlank);
    // Numbers (Dates included) compare as numbers; the text-date parser would read them as blank.
    return (typeof av === "number" && typeof bv === "number" ? cellCompare : compare)(av, bv, dir);
  });
}

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
