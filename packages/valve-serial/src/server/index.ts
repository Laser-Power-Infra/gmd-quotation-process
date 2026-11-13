import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { SQL_COLUMNS, type ValveSerialPageData, type ValveSerialRow } from "../columns";

// One filtered/sorted page of valve_serial in SQL, the Supply History columns
// included, so the client never holds more than a page. Column kinds come from
// SQL_COLUMNS; this file only knows how each column reads in SQL.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

/** First ERP supply line of the serial's invoice; (invoiceNo, itemName) is unique, so the index gives the order. */
const FROM = sql`FROM "valve_serial" v LEFT JOIN LATERAL (
  SELECT h."partyName", h."erpContractNo", h."date" FROM "SupplyHistoryItem" h
  WHERE h."invoiceNo" = v."invoiceNo" ORDER BY h."itemName" LIMIT 1
) s ON TRUE`;

const SUPPLY: Record<string, Prisma.Sql> = {
  supplyParty: sql`s."partyName"`,
  supplyContract: sql`s."erpContractNo"`,
  supplyDate: sql`s."date"`,
};

/** Only keys found in SQL_COLUMNS reach this, so the raw identifier is never user text. */
const exprOf = (key: string) => SUPPLY[key] ?? Prisma.raw(`v."${key}"`);
const columnOf = (key: string) => SQL_COLUMNS.find((c) => c.key === key);
const text = (e: Prisma.Sql) => sql`btrim(coalesce(${e}, ''))`;
/** Numeric value of a text cell ("1,000" -> 1000); NULL when not a number. */
const num = (e: Prisma.Sql) =>
  sql`(CASE WHEN replace(${text(e)}, ',', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN replace(${text(e)}, ',', '')::numeric END)`;
const MONTHS = Prisma.raw("ARRAY['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']");
/**
 * ISO yyyy-mm-dd, or dd-MMM-yy(yy) as Supply History stores dates (as execution-registers reads them).
 * Day is added to the 1st so a junk day (31 Feb) rolls over instead of failing the query.
 */
const day = (e: Prisma.Sql) => {
  const t = text(e);
  return sql`(CASE
    WHEN ${t} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}$'
      THEN make_date(substr(${t}, 1, 4)::int, substr(${t}, 6, 2)::int, 1) + (substr(${t}, 9, 2)::int - 1)
    WHEN ${t} ~ '^[0-9]{1,2}-[A-Za-z]{3}-([0-9]{2}|[12][0-9]{3})$' THEN make_date(
      CASE WHEN length(split_part(${t}, '-', 3)) = 2 THEN 2000 + split_part(${t}, '-', 3)::int ELSE split_part(${t}, '-', 3)::int END,
      array_position(${MONTHS}, upper(split_part(${t}, '-', 2))), 1) + (split_part(${t}, '-', 1)::int - 1)
  END)`;
};

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (e: Prisma.Sql, value: string) =>
  sql`regexp_replace(${e}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE for `query`; `skip` drops one column's own filters so its facet keeps every option. */
export function buildWhere(query: TableQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters)) {
    if (key === skip || !values?.length || !columnOf(key)) continue;
    const t = text(exprOf(key));
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${t} = ''` : sql`${t} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (key === skip || !value.trim() || !columnOf(key)) continue;
    parts.push(contains(text(exprOf(key)), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (key === skip || columnOf(key)?.kind !== "date") continue;
    const d = day(exprOf(key));
    if (range.from) parts.push(sql`${d} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${d} <= ${range.to}::date`);
  }
  const search = query.search.trim();
  if (search) parts.push(contains(Prisma.join(SQL_COLUMNS.map((c) => text(exprOf(c.key))), " || ' ' || "), search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

// Latest edits first; the serial no keeps the order stable across pages.
const FALLBACK_ORDER = sql`v."updatedAt" DESC, v."serialNo" ASC`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && columnOf(sort.key);
  if (!sort || !column?.sortable) return FALLBACK_ORDER;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  const e = exprOf(column.key);
  if (column.kind === "date") return sql`${day(e)} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
  if (column.kind === "number") return sql`${num(e)} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
  const nulls = Prisma.raw(sort.dir === "asc" ? "NULLS LAST" : "NULLS FIRST");
  return sql`NULLIF(lower(${text(e)}), '') ${dir} ${nulls}, ${FALLBACK_ORDER}`;
}

/** The two statements behind one page: its rows, and the count under the same filters. */
export function pageSql(query: TableQuery) {
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const offset = Math.max(0, query.page - 1) * pageSize;
  const where = buildWhere(query);
  return {
    rows: sql`SELECT v.*, s."partyName" AS "supplyParty", s."erpContractNo" AS "supplyContract", s."date" AS "supplyDate"
      ${FROM} WHERE ${where} ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    count: sql`SELECT count(*)::int AS total ${FROM} WHERE ${where}`,
  };
}

type RawRow = Omit<ValveSerialRow, "updatedAt" | "stockCode" | "stockLocation" | "stockQty"> & { createdAt: Date; updatedAt: Date };

export async function listValveSerialPage(query: TableQuery): Promise<ValveSerialPageData> {
  const q = pageSql(query);
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw<RawRow[]>(q.rows),
    prisma.$queryRaw<{ total: number }[]>(q.count),
  ]);
  return {
    // The host fills the stock columns from the stock DB.
    rows: rows.map(({ createdAt: _c, updatedAt, ...r }) => ({ ...r, updatedAt: updatedAt.toISOString(), stockCode: null, stockLocation: null, stockQty: null })),
    total,
  };
}

/** Distinct values of a column under every other active filter; empty cells come first as BLANK. */
export async function listValveSerialFacet(key: string, query: TableQuery): Promise<string[]> {
  if (!columnOf(key)) return [];
  const rows = await prisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT ${text(exprOf(key))} AS v
    ${FROM} WHERE ${buildWhere(query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
