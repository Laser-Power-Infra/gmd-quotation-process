import { prisma } from "@/lib/prisma";

/**
 * Rate tables are LookupOption rows of one type with value "<key>=<Rs/kg>;from=<yyyy-mm-dd>"
 * (";from=" optional). Keys may themselves contain "=" (machining band "<=100"), so the
 * rate is split off at the LAST "=".
 */
export function parseRateRows(rows: { value: string }[], keys: readonly string[]) {
  const rates: Record<string, string> = Object.fromEntries(keys.map((k) => [k, ""]));
  const dates: Record<string, string> = Object.fromEntries(keys.map((k) => [k, ""]));
  for (const row of rows) {
    const [head, ...rest] = row.value.split(";");
    const eq = head.lastIndexOf("=");
    if (eq === -1) continue;
    const key = head.slice(0, eq).trim();
    if (!(key in rates)) continue;
    rates[key] = head.slice(eq + 1).trim();
    const from = rest.find((p) => p.trim().startsWith("from="));
    if (from) dates[key] = from.trim().slice(5);
  }
  return { rates, dates };
}

export async function loadRates(type: string, keys: readonly string[]) {
  return parseRateRows(await prisma.lookupOption.findMany({ where: { type } }), keys);
}
