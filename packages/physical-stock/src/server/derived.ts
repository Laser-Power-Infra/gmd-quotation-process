import "server-only";
import { stockPrisma } from "@gmd/db-stock";
import { buildSerial } from "../columns";
import { fgMatcher } from "../codeOptions";

// Stored derived columns (fg_item_code, production_item, HeatEntry.serial_no)
// so the stock page can filter and sort them in SQL. Called hourly after the
// FgBomOption sync for every row, and per row after an edit that feeds them.

export const DERIVED_INPUT_FIELDS = new Set(["l8_item_category", "l2_valve_type", "l5_material", "dimension", "erp_code"]);

export interface DerivedValues {
  fg_item_code: string | null;
  production_item: string | null;
  serial_no: string | null;
}

export async function refreshDerived(ids?: string[]): Promise<Map<string, DerivedValues>> {
  const [rows, fg] = await Promise.all([
    stockPrisma.physicalStock.findMany({
      where: ids ? { id: { in: ids } } : {},
      include: { heat_entries: { orderBy: { created_at: "asc" } } },
    }),
    stockPrisma.fgBomOption.findMany().catch(() => []),
  ]);
  const matchFg = fgMatcher(fg);
  const out = new Map<string, DerivedValues>();
  // One updateMany per distinct (fg, production) pair instead of one update per row.
  const groups = new Map<string, { data: { fg_item_code: string | null; production_item: string | null }; ids: string[] }>();
  const serials: Promise<unknown>[] = [];
  for (const row of rows) {
    const m = matchFg(row);
    const serial = row.heat_entries.map((e) => buildSerial(row, e));
    out.set(row.id, { ...m, serial_no: serial.length ? serial.join(", ") : null });
    if (m.fg_item_code !== row.fg_item_code || m.production_item !== row.production_item) {
      const key = `${m.fg_item_code}|${m.production_item}`;
      const g = groups.get(key) ?? { data: m, ids: [] };
      g.ids.push(row.id);
      groups.set(key, g);
    }
    row.heat_entries.forEach((e, i) => {
      if (e.serial_no !== serial[i]) {
        serials.push(stockPrisma.heatEntry.update({ where: { id: e.id }, data: { serial_no: serial[i] } }));
      }
    });
  }
  await Promise.all([
    ...[...groups.values()].map((g) => stockPrisma.physicalStock.updateMany({ where: { id: { in: g.ids } }, data: g.data })),
    ...serials,
  ]);
  return out;
}
