import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { matchItemType } from "@gmd/dashboard/lib/itemTypePatterns";
import { sortRows } from "@gmd/dashboard/lib/tableSort";
import type { TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import {
  DIMS,
  FY_PATTERN,
  addLine,
  currentFy,
  emptyCell,
  fyVariants,
  isDimKey,
  isView,
  saleMoney,
  viewValue,
  type DimKey,
  type PricedLine,
  type SalesKpi,
  type SalesPageData,
  type SalesRow,
  type View,
} from "../columns";

// The Sales Register on the server. SQL builds one fiscal year of invoice lines (`l`, columns named by
// the filter keys), filters, facets and totals them. A line's cost needs the BOM + GRN cost book, which
// spans the stock database, so the host costs the filtered lines and the group × month cells are added
// up here, then sorted and paged: the browser gets one page of groups. No auth here: the host owns it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const lcol = (key: string) => Prisma.raw(`l."${key}"`);
const text = (column: string) => sql`btrim(coalesce(${Prisma.raw(column)}, ''))`;
/** parseFloat of a sheet cell ("1,200" -> 1200); NULL when it does not start with a number. */
const num = (column: string) =>
  sql`substring(replace(${text(column)}, ',', '') FROM '^[-+]?(?:[0-9]+[.]?[0-9]*|[.][0-9]+)(?:[eE][-+]?[0-9]{1,2})?')::float8`;
const MONTHS = Prisma.raw("ARRAY['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']");
/**
 * dd-MMM-yy(yy) or ISO text -> date, as parseGmdDate reads it; NULL otherwise. Built as the 1st plus
 * days, so a junk day (31-Feb) rolls over instead of failing the whole query.
 */
const day = (column: string) => {
  const t = text(column);
  return sql`(CASE
    WHEN ${t} ~ '^[0-9]{1,2}-[A-Za-z]{3}-([0-9]{2}|[12][0-9]{3})$' THEN make_date(
      CASE WHEN length(split_part(${t}, '-', 3)) = 2 THEN 2000 + split_part(${t}, '-', 3)::int ELSE split_part(${t}, '-', 3)::int END,
      array_position(${MONTHS}, upper(split_part(${t}, '-', 2))), 1) + (split_part(${t}, '-', 1)::int - 1)
    WHEN ${t} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}'
      THEN make_date(substr(${t}, 1, 4)::int, substr(${t}, 6, 2)::int, 1) + (substr(${t}, 9, 2)::int - 1)
  END)`;
};

/** The sheet's valve label: TYPE OF VALVE, else the derived item type. */
const LABEL = sql`coalesce(nullif(${text('s."typeOfValve"')}, ''), ${text('s."derivedItemType"')})`;
/** The item code as the item masters key it (normalizeKey: trimmed, single-spaced, upper case). */
const CODE = sql`upper(btrim(regexp_replace(coalesce(s."erpItemCode", ''), '[[:space:]]+', ' ', 'g')))`;
const inFy = (fy: string) => sql`s."financialYear" = ANY(${fyVariants(fy)}::text[])`;

/** The year's sheet labels that name an item type by keyword (matchItemType), with that type; as two unnest arrays. */
export type KeywordTypes = { labels: string[]; types: string[] };

// The keyword rules are JS regexes: they run here over the year's distinct labels, not per line in SQL.
async function keywordTypes(fy: string): Promise<KeywordTypes> {
  const rows = await prisma.$queryRaw<{ label: string }[]>`SELECT DISTINCT ${LABEL} AS label FROM "SupplyHistoryItem" s WHERE ${inFy(fy)}`;
  const out: KeywordTypes = { labels: [], types: [] };
  for (const { label } of rows) {
    const type = matchItemType(label);
    if (type) {
      out.labels.push(label);
      out.types.push(type);
    }
  }
  return out;
}

/**
 * One fiscal year of invoice lines. Valve type: the item master's type for the code (FullItem, else
 * RawMaterial), else the label's keyword type, else the label as written, else "-".
 */
export function linesSql(fy: string, kw: KeywordTypes): Prisma.Sql {
  return sql`SELECT s.id, s."invoiceNo", coalesce(to_char(${day('s."date"')}, 'YYYY-MM'), '') AS "month",
      coalesce(nullif(${text('s."erpPartyName"')}, ''), nullif(${text('s."consigneeName"')}, ''), nullif(${text('s."partyName"')}, ''), '-') AS "party",
      coalesce(nullif(btrim(fi."itemType"), ''), nullif(btrim(rm."l2ValveType"), ''), kw.type, nullif(${LABEL}, ''), '-') AS "valveType",
      coalesce(nullif(${text('s."sizeOfValve"')}, ''), nullif(${text('s."derivedSize"')}, ''), '-') AS "size",
      coalesce(nullif(${text('s."classOfValve"')}, ''), '-') AS "pressureClass",
      coalesce(${num('s."value"')}, 0) AS "amount",
      s."quantity", s."value", s."erpItemCode", s."date", s."erpContractNo", s."itemName"
    FROM "SupplyHistoryItem" s
    LEFT JOIN "FullItem" fi ON ${CODE} <> '' AND fi."itemCode" = ${CODE}
    LEFT JOIN "RawMaterial" rm ON ${CODE} <> '' AND rm."erpItemCode" = ${CODE}
    LEFT JOIN unnest(${kw.labels}::text[], ${kw.types}::text[]) AS kw(label, type) ON kw.label = ${LABEL}
    WHERE ${inFy(fy)}`;
}

/** The fy, grouping and view a query asks for; anything unknown falls back to this year, by party, in sales. */
export function optionsOf(query: TableQuery): { fy: string; group: DimKey; view: View } {
  const x = query.extra ?? {};
  return {
    fy: typeof x.fy === "string" && FY_PATTERN.test(x.fy) ? x.fy : currentFy(),
    group: isDimKey(x.group) ? x.group : "party",
    view: isView(x.view) ? x.view : "sales",
  };
}

const FILTER_KEYS = new Set<string>([...DIMS.map((d) => d.key), "month"]);
const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`: the dimension and month filters, "contains" per dimension, and the search box; `skip` drops one key's own. */
export function buildWhere(query: TableQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (values?.length && key !== skip && FILTER_KEYS.has(key)) parts.push(sql`${lcol(key)} = ANY(${values}::text[])`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value.trim() && key !== skip && isDimKey(key)) parts.push(contains(lcol(key), value));
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(sql`l."party" || ' ' || l."invoiceNo" || ' ' || l."valveType" || ' ' || l."size" || ' ' || l."pressureClass"`, search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

const salesRow = (key: string): SalesRow => ({ id: key, key, byMonth: {}, total: emptyCell() });

/**
 * Group × month cells. The All row adds the same lines, so its GP % is weighted, never an average of
 * the rows'. Biggest sales first, then `sort`: the group, "total" or a month, by its value in `view`.
 */
export function pivot(lines: (PricedLine & Record<DimKey | "month", string>)[], group: DimKey, view: View, sort: TableSort | null) {
  const groups = new Map<string, SalesRow>();
  const all = salesRow("All");
  for (const l of lines) {
    const g = groups.get(l[group]) ?? salesRow(l[group]);
    groups.set(g.key, g);
    for (const r of [g, all]) {
      if (l.month) addLine((r.byMonth[l.month] ??= emptyCell()), l);
      addLine(r.total, l);
    }
  }
  const rows = [...groups.values()].sort((a, b) => b.total.sales - a.total.sales);
  return { rows: sortRows(rows, sort, (r, k) => (k === group ? r.key : viewValue(k === "total" ? r.total : r.byMonth[k], view))), all };
}

/** What the host needs to cost a line. */
export type SaleCostInput = { valveType: string; size: string; itemName: string; erpItemCode: string | null; date: string | null; erpContractNo: string | null };
/** Unit cost and quoted unit cost (null = missing, never 0), and the minimum VA% of the line's item. */
export type LineCost = { unitCost: number | null; quotedUnitCost: number | null; minVa: number };
/** The host's costing, in input order: the cost book spans the stock database and the VA% rules are app rules. */
export type CostOf = (lines: SaleCostInput[]) => Promise<LineCost[]>;

type LineOut = SaleCostInput & Record<DimKey | "month", string> & { quantity: string | null; value: string | null };
/** One filtered line set, costed, with its SQL totals. */
type Costed = { lines: (PricedLine & Record<DimKey | "month", string>)[]; kpi: SalesKpi; syncedAt: string | null; years: string[] };

async function listYears(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ fy: string }[]>`SELECT DISTINCT btrim("financialYear") AS fy FROM "SupplyHistoryItem"
    WHERE btrim("financialYear") ~ '^[0-9]{4}-[0-9]{2}$' ORDER BY 1 DESC`;
  return rows.map((r) => r.fy);
}

async function loadCosted(query: TableQuery, fy: string, costOf: CostOf): Promise<Costed> {
  const [kw, years] = await Promise.all([keywordTypes(fy), listYears()]);
  const l = sql`WITH l AS (${linesSql(fy, kw)})`;
  const where = buildWhere(query);
  const [lines, [kpi]] = await Promise.all([
    prisma.$queryRaw<LineOut[]>`${l} SELECT l."month", l."party", l."valveType", l."size", l."pressureClass", l."quantity", l."value",
      l."erpItemCode", l."date", l."erpContractNo", l."itemName" FROM l WHERE ${where}`,
    prisma.$queryRaw<(SalesKpi & { syncedAt: Date | null })[]>`${l} SELECT count(*)::int AS "lines", coalesce(sum(l."amount"), 0)::float8 AS "sales",
      count(DISTINCT l."invoiceNo")::int AS "invoices", count(DISTINCT l."party")::int AS "parties",
      (count(*) FILTER (WHERE l."month" = ''))::int AS "undated",
      (SELECT "syncedAt" FROM engineering_sync WHERE "tabKey" = 'execution-tracking') AS "syncedAt"
      FROM l WHERE ${where}`,
  ]);
  const costs = await costOf(lines);
  const { syncedAt, ...totals } = kpi;
  return {
    lines: lines.map((line, i) => ({ ...line, ...saleMoney(line.quantity, line.value, costs[i].unitCost, costs[i].quotedUnitCost), minVa: costs[i].minVa })),
    kpi: totals,
    syncedAt: syncedAt instanceof Date ? syncedAt.toISOString() : null,
    years,
  };
}

// shortcut: costing a year reads the stock DB (1-2 s), so each filtered line set stays costed for a minute and a sort,
// page, group or view change only re-pivots it; store the cost on the synced rows if that lag or memory ever matters.
const COSTED_MS = 60_000;
const COSTED_SETS = 20;
const costed = new Map<string, { at: number; value: Promise<Costed> }>();

function costedLines(query: TableQuery, fy: string, costOf: CostOf): Promise<Costed> {
  const key = JSON.stringify([fy, query.filters ?? {}, query.columnSearch ?? {}, (query.search ?? "").trim()]);
  const hit = costed.get(key);
  if (hit && Date.now() - hit.at < COSTED_MS) return hit.value;
  const value = loadCosted(query, fy, costOf);
  costed.delete(key);
  costed.set(key, { at: Date.now(), value });
  // A failed load is not kept; Map order is insertion order, so the first key is the oldest set.
  value.catch(() => costed.get(key)?.value === value && costed.delete(key));
  if (costed.size > COSTED_SETS) costed.delete(costed.keys().next().value!);
  return value;
}

export async function listSalesPage(query: TableQuery, costOf: CostOf): Promise<SalesPageData> {
  const { fy, group, view } = optionsOf(query);
  const { lines, kpi, syncedAt, years } = await costedLines(query, fy, costOf);
  const { rows, all } = pivot(lines, group, view, query.sort);
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total: rows.length,
    meta: { fy, years: years.includes(fy) ? years : [fy, ...years], all, kpi, syncedAt },
  };
}

/** Distinct values of one dimension under every other active filter. */
export async function listSalesFacet(key: string, query: TableQuery): Promise<string[]> {
  if (!isDimKey(key)) return [];
  const { fy } = optionsOf(query);
  const rows = await prisma.$queryRaw<{ v: string }[]>`WITH l AS (${linesSql(fy, await keywordTypes(fy))})
    SELECT DISTINCT ${lcol(key)} AS v FROM l WHERE ${buildWhere(query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  return rows.map((r) => r.v);
}
