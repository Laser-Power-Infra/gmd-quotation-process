const formatterCache = new Map<number, Intl.NumberFormat>();

function getIndianNumberFormatter(minimumFractionDigits: number): Intl.NumberFormat {
  let formatter = formatterCache.get(minimumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits,
      maximumFractionDigits: Math.max(2, minimumFractionDigits),
    });
    formatterCache.set(minimumFractionDigits, formatter);
  }
  return formatter;
}

/**
 * Format a numeric value using Indian digit grouping (thousands/lakhs/crores),
 * e.g. 1234567 -> "12,34,567" and 1234.5 -> "1,234.5".
 * Returns "" for blank / non-numeric input so callers can keep their "-" fallback.
 *
 * Pass minimumFractionDigits (e.g. 2) for totals that should always show decimals.
 */
export function formatIndianNumber(
  value: number | string | null | undefined,
  minimumFractionDigits = 0
): string {
  if (value === null || value === undefined || value === "") return "";
  const n =
    typeof value === "number"
      ? value
      : parseFloat(String(value).replace(/,/g, "").trim());
  if (Number.isNaN(n)) return "";
  return getIndianNumberFormatter(minimumFractionDigits).format(n);
}

/** Lakh format: 1234567 -> "₹12.35 L"; crores above 1e7. */
export function formatLakh(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  return `${s}₹${(a / 1e5).toFixed(2)} L`;
}
