import "server-only";
import { Prisma, stockPrisma } from "@gmd/db-stock";
import { BLANK, type TablePage, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { STOCK_COLUMNS } from "../stockColumns";
import type { MajorMinorKind, StockQueryExtra } from "../state/tableSlice";
import type { PhysicalStockRow } from "../types";

// One filtered/sorted page of PhysicalStock in SQL, derived columns included,
// so the client never holds more than a page. Column kinds come from
// STOCK_COLUMNS; this file only knows how each field reads in SQL.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const col = (field: string) => Prisma.raw(`p."${field}"`);
/** Numeric value of a text qty/cost cell ("1,000" -> 1000); NULL when not a number. */
const num = (e: Prisma.Sql) =>
  sql`(CASE WHEN replace(btrim(coalesce((${e})::text, '')), ',', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN replace(btrim((${e})::text), ',', '')::numeric END)`;
const text = (e: Prisma.Sql) => sql`btrim(coalesce((${e})::text, ''))`;

const IN_TRANSIT_LINES = sql`FROM "PurchaseOrderLine" l WHERE l."itemCode" = btrim(p.erp_code) AND l."inTransit" > 0`;

/** SQL that reads each field: `text` for display/filter/facet, `raw` for date and number sorting. */
const DERIVED: Partial<Record<keyof PhysicalStockRow, { text: Prisma.Sql; raw?: Prisma.Sql }>> = {
  form_date: { text: sql`to_char(p.form_date, 'YYYY-MM-DD')`, raw: sql`p.form_date` },
  majorminor_marking: { text: sql`(CASE p.majorminor_marking WHEN true THEN 'Major' WHEN false THEN 'Minor' END)` },
  item_wise_value: { text: sql`round(coalesce(${num(col("cost"))}, 0) * coalesce(${num(col("available_qty"))}, 0), 2)::text` },
  entry_no: { text: sql`(SELECT string_agg(e.entry_no, ', ' ORDER BY e.created_at) FROM "StockEntry" e WHERE e.physical_stock_id = p.id)` },
  heat_no: { text: sql`(SELECT string_agg(DISTINCT h.heat_no, ', ') FROM "HeatEntry" h WHERE h.physical_stock_id = p.id)` },
  serial_no: { text: sql`(SELECT string_agg(h.serial_no, ', ' ORDER BY h.created_at) FROM "HeatEntry" h WHERE h.physical_stock_id = p.id)` },
  in_transit: { text: sql`(SELECT sum(l."inTransit") ${IN_TRANSIT_LINES})` },
  // shortcut: format duplicated from incomingFromForItems (@gmd/purchase), unify when purchase moves to SQL
  incoming_from: {
    text: sql`(SELECT string_agg(
      coalesce(nullif(l."supplierName", ''), 'Unknown supplier') || ' — PO ' || l."poNo"
        || coalesce(' (' || l."poDate" || ')', '') || coalesce(', due ' || l."deliverySched", '')
        || ': ' || coalesce(l."balanceQty", '?') || ' pending, ' || coalesce(nullif(l."qtyExecuted", ''), '0') || ' received',
      '; ' ORDER BY l."poDate", l."poNo") ${IN_TRANSIT_LINES})`,
  },
};

const exprOf = (field: string) => DERIVED[field as keyof PhysicalStockRow] ?? { text: col(field) };

/** Rows sharing location + every L column but holding a different ERP code: the same stock counted twice. */
const DUPLICATE_KEYS = ["location", "l2_valve_type", "dimension", "l7_dimension", "l4_component", "l5_material", "l6_std", "l8_item_category"];
const IS_DUPLICATE = sql`EXISTS (SELECT 1 FROM "PhysicalStock" d WHERE d.id <> p.id
  AND coalesce(d.erp_code, '') <> coalesce(p.erp_code, '')
  AND ${Prisma.join(DUPLICATE_KEYS.map((k) => sql`coalesce(d.${Prisma.raw(`"${k}"`)}, '') = coalesce(p.${Prisma.raw(`"${k}"`)}, '')`), " AND ")})`;

const MAJOR_MINOR_SQL: Record<MajorMinorKind, Prisma.Sql> = {
  yes: sql`p.majorminor_marking IS TRUE`,
  no: sql`p.majorminor_marking IS FALSE`,
  blank: sql`p.majorminor_marking IS NULL`,
};

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");

export type StockTableQuery = TableQuery & { extra?: Partial<StockQueryExtra> };

/** WHERE for `query`; `skip` drops one column's own filter (facets cascade) or the major/minor predicate. */
export function buildWhere(query: StockTableQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [field, values] of Object.entries(query.filters)) {
    if (field === skip || !values?.length || !STOCK_COLUMNS.some((c) => c.field === field)) continue;
    const t = text(exprOf(field).text);
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${t} = ''` : sql`${t} = ${v}`)), " OR ")})`);
  }
  for (const [field, value] of Object.entries(query.columnSearch ?? {})) {
    if (field === skip || !value.trim() || !STOCK_COLUMNS.some((c) => c.field === field)) continue;
    parts.push(sql`regexp_replace(${text(exprOf(field).text)}, '\s', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`);
  }
  for (const [field, range] of Object.entries(query.dateRanges ?? {})) {
    const column = STOCK_COLUMNS.find((c) => c.field === field);
    if (field === skip || !column || column.kind !== "date") continue;
    const raw = exprOf(field).raw ?? exprOf(field).text;
    if (range.from) parts.push(sql`${raw} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${raw} < (${range.to}::date + interval '1 day')`);
  }
  const search = query.search.trim();
  if (search) {
    const all = Prisma.join(STOCK_COLUMNS.map((c) => text(exprOf(c.field).text)), " || ' ' || ");
    parts.push(sql`regexp_replace(${all}, '\\s', '', 'g') ILIKE ${`%${escapeLike(squish(search))}%`}`);
  }
  const extra = query.extra ?? {};
  if (extra.card === "qty") parts.push(sql`coalesce(${num(col("available_qty"))}, 0) > 0`);
  if (extra.card === "value") parts.push(sql`coalesce(${num(col("cost"))}, 0) * coalesce(${num(col("available_qty"))}, 0) > 0`);
  if (skip !== "majorMinor" && extra.majorMinor?.length) {
    parts.push(sql`(${Prisma.join(extra.majorMinor.map((k) => MAJOR_MINOR_SQL[k]), " OR ")})`);
  }
  if (extra.duplicatesOnly) parts.push(IS_DUPLICATE);
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

const FALLBACK_ORDER = sql`p.form_date DESC, p.created_at DESC, p.id ASC`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && STOCK_COLUMNS.find((c) => c.field === sort.key);
  if (!sort || !column || !column.sortable) return FALLBACK_ORDER;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  const e = exprOf(sort.key);
  if (column.kind === "date") return sql`${e.raw ?? e.text} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
  if (column.kind === "number") return sql`${num(e.text)} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
  const nulls = Prisma.raw(sort.dir === "asc" ? "NULLS LAST" : "NULLS FIRST");
  return sql`NULLIF(lower(${text(e.text)}), '') ${dir} ${nulls}, ${FALLBACK_ORDER}`;
}

export interface StockPageMeta {
  totals: { availableQty: number; availableValue: number };
  majorMinorCounts: Record<MajorMinorKind, number>;
}

type RawRow = Omit<PhysicalStockRow, "form_date" | "in_transit"> & {
  form_date: Date | null;
  in_transit: number | string | null;
  created_at: Date;
  updated_at: Date;
};

const DERIVED_SELECT = Prisma.join(
  Object.entries(DERIVED)
    .filter(([f]) => f !== "form_date" && f !== "majorminor_marking")
    .map(([f, e]) => sql`${e.text} AS ${Prisma.raw(`"${f}"`)}`),
  ", ",
);

/** The three statements behind one page: rows, totals over the filter, major/minor counts without that filter. */
export function pageSql(query: StockTableQuery, opts: { duplicates?: boolean } = {}) {
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const offset = Math.max(0, query.page - 1) * pageSize;
  const where = buildWhere(query);
  const duplicate = opts.duplicates ? sql`, ${IS_DUPLICATE} AS is_duplicate` : sql``;
  return {
    rows: sql`SELECT p.*, ${DERIVED_SELECT}${duplicate}
      FROM "PhysicalStock" p WHERE ${where} ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    agg: sql`SELECT count(*)::int AS total,
      coalesce(sum(${num(col("available_qty"))}), 0)::float AS qty,
      coalesce(sum(coalesce(${num(col("cost"))}, 0) * coalesce(${num(col("available_qty"))}, 0)), 0)::float AS value
      FROM "PhysicalStock" p WHERE ${where}`,
    counts: sql`SELECT p.majorminor_marking AS m, count(*)::int AS n
      FROM "PhysicalStock" p WHERE ${buildWhere(query, "majorMinor")} GROUP BY 1`,
  };
}

export async function listPhysicalStockPage(
  query: StockTableQuery,
  opts: { duplicates?: boolean } = {},
): Promise<TablePage<PhysicalStockRow, StockPageMeta>> {
  const q = pageSql(query, opts);
  const [rows, [agg], counts] = await Promise.all([
    stockPrisma.$queryRaw<RawRow[]>(q.rows),
    stockPrisma.$queryRaw<{ total: number; qty: number; value: number }[]>(q.agg),
    stockPrisma.$queryRaw<{ m: boolean | null; n: number }[]>(q.counts),
  ]);
  const majorMinorCounts: Record<MajorMinorKind, number> = { yes: 0, no: 0, blank: 0 };
  for (const c of counts) majorMinorCounts[c.m === true ? "yes" : c.m === false ? "no" : "blank"] = c.n;
  return {
    rows: rows.map(({ created_at: _c, updated_at: _u, form_date, in_transit, ...rest }) => ({
      ...rest,
      form_date: form_date ? form_date.toISOString() : null,
      in_transit: in_transit === null ? null : Number(in_transit),
    })),
    total: agg.total,
    meta: { totals: { availableQty: agg.qty, availableValue: agg.value }, majorMinorCounts },
  };
}

/** Distinct values of `field` under every other active filter; empty cells come first as BLANK. */
export async function listPhysicalStockFacet(field: string, query: StockTableQuery): Promise<string[]> {
  if (!STOCK_COLUMNS.some((c) => c.field === field)) return [];
  const rows = await stockPrisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT ${text(exprOf(field).text)} AS v
    FROM "PhysicalStock" p WHERE ${buildWhere(query, field)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
