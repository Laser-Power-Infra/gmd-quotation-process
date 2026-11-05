import type { ColumnKind } from "./types";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Display text of a cell by column kind; anything unparsable shows as typed. */
export function formatCell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "number") {
    const n = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? number.format(n) : String(value);
  }
  if (kind === "date") {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : date.format(d);
  }
  if (kind === "boolean") return value === true ? "Yes" : value === false ? "No" : String(value);
  return String(value);
}
