// Date presets for the supply history sidebar. Each preset resolves to the
// dateFrom/dateTo range the server already filters the Date column by.

export interface DatePreset {
  fy: string; // "2025-26"
  year: string; // "2025"
  month: string; // "01".."12"
  day: string; // "01".."31"
}

export const EMPTY_DATE_PRESET: DatePreset = { fy: "", year: "", month: "", day: "" };

export const MONTH_OPTIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
].map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

const pad = (n: number) => String(n).padStart(2, "0");

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function presetRange(p: DatePreset): { dateFrom: string; dateTo: string } {
  if (p.fy) {
    const start = Number(p.fy.slice(0, 4));
    return { dateFrom: `${start}-04-01`, dateTo: `${start + 1}-03-31` };
  }
  if (!p.year) return { dateFrom: "", dateTo: "" };
  if (!p.month) return { dateFrom: `${p.year}-01-01`, dateTo: `${p.year}-12-31` };
  if (p.day) {
    const date = `${p.year}-${p.month}-${p.day}`;
    return { dateFrom: date, dateTo: date };
  }
  const last = daysInMonth(Number(p.year), Number(p.month));
  return {
    dateFrom: `${p.year}-${p.month}-01`,
    dateTo: `${p.year}-${p.month}-${pad(last)}`,
  };
}

// Financial year runs April to March, so it starts in the calendar year
// before the current one until April.
export function fyOptions(today: Date = new Date(), count = 10): string[] {
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `${y}-${pad((y + 1) % 100)}`;
  });
}

export function yearOptions(today: Date = new Date(), count = 10): string[] {
  return Array.from({ length: count }, (_, i) => String(today.getFullYear() - i));
}
