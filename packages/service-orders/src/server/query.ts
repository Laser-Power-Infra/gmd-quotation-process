import "server-only";
import { prisma } from "@gmd/db-quotation";
import { Prisma, stockPrisma } from "@gmd/db-stock";
import { BLANK, type DataColumn, type TableSort } from "@gmd/ui/components/data-table/types";
import { COLUMNS, type ServiceOrderRow, type ServiceOrdersPageData, type ServiceOrdersQuery } from "../columns";

// Service / Work Orders in SQL: paged, filtered, faceted and totalled on the server. The service
// codes live in the quotation DB and the PO + GRN lines in the stock DB, so the codes go into the
// stock-DB query as one array parameter. CTE `l` holds one row per service PO line, its columns
// named by the column keys; only keys listed in ../columns reach the SQL. No auth here: the host's
// actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const lcol = (key: string) => Prisma.raw(`l."${key}"`);
/** Trimmed text of a cell; '' for NULL. */
const text = (column: string) => sql`btrim(coalesce(${Prisma.raw(column)}, ''))`;
/** Numeric value of a sheet number ("1,250.00" -> 1250); NULL when not a number. */
const num = (column: string) => {
  const t = sql`regexp_replace(coalesce(${Prisma.raw(column)}, ''), '[[:space:],]', '', 'g')`;
  return sql`(CASE WHEN ${t} ~ '^-?[0-9]*[.]?[0-9]+$' THEN ${t}::numeric END)`;
};
/**
 * YYYY-MM-DD (DELIVERY_SCH) or D-M-YYYY (VRDATE) text -> date; NULL otherwise. Built as the 1st plus
 * days, so a junk day (31-02) rolls over instead of failing the whole query.
 */
const day = (column: string) => {
  const t = text(column);
  return sql`(CASE
    WHEN ${t} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}$'
      THEN make_date(substr(${t}, 1, 4)::int, substr(${t}, 6, 2)::int, 1) + (substr(${t}, 9, 2)::int - 1)
    WHEN ${t} ~ '^[0-9]{1,2}-(0?[1-9]|1[0-2])-[12][0-9]{3}$'
      THEN make_date(split_part(${t}, '-', 3)::int, split_part(${t}, '-', 2)::int, 1) + (split_part(${t}, '-', 1)::int - 1)
  END)`;
};

/**
 * `s`: the PO lines of the service codes. `r`: their receipts, joined on ORDER_VRNO + ORDER_SLNO =
 * VRNO + SLNO; the last one by GRN date. `l`: one row per line, columns named by the column keys.
 * Pending is the purchase-orders sync's `inTransit`: BALANCE floored at 0, else ordered - received.
 */
export function linesSql(codes: string[]): Prisma.Sql {
  return sql`s AS (
    SELECT p.id, ${text('p."poNo"')} AS "orderNo", ${text('p."poLineNo"')} AS "lineNo", ${day('p."poDate"')} AS "orderDate",
      coalesce(nullif(${text('p."supplierName"')}, ''), ${text('p."supplierCode"')}) AS supplier, ${text('p."supplierCode"')} AS "supplierCode",
      ${text('p."itemCode"')} AS "serviceCode", ${text('p."itemName"')} AS "serviceName", ${text('p."uom"')} AS um,
      ${num('p."netQtyOrder"')} AS ordered, ${num('p."qtyExecuted"')} AS received, coalesce(p."inTransit", 0)::numeric AS pending,
      ${num('p."rate"')} AS rate, ${num('p."exchangeRate"')} AS fx, ${day('p."deliverySched"')} AS "dueDate"
    FROM "PurchaseOrderLine" p
    WHERE upper(${text('p."itemCode"')}) = ANY(${codes}::text[])
  ), r AS (
    SELECT upper(${text('g."orderVrNo"')}) AS vr, ${text('g."orderSlNo"')} AS sl, count(*)::int AS n, max(g.d) AS d,
      (array_agg(${text('g."vrNo"')} ORDER BY g.d DESC NULLS LAST, g."vrNo" DESC))[1] AS "grnNo",
      (array_agg(${text('g."partyBillNo"')} ORDER BY g.d DESC NULLS LAST, g."vrNo" DESC))[1] AS "billNo"
    FROM (SELECT g.*, ${day('g."vrDate"')} AS d FROM "GrnLine" g) g
    WHERE upper(${text('g."orderVrNo"')}) IN (SELECT upper("orderNo") FROM s)
    GROUP BY 1, 2
  ), l AS (
    SELECT s.id, s."orderNo", s."lineNo", s."orderDate", s.supplier, s."supplierCode", s."serviceCode", s."serviceName", s.um,
      s.ordered, s.received, s.pending, s.rate, s.pending * s.rate * coalesce(nullif(s.fx, 0), 1) AS "pendingValue", s."dueDate",
      s.pending > 0 AS open,
      CASE WHEN s.pending > 0 THEN current_date - s."orderDate" END AS "daysPending",
      s.pending > 0 AND coalesce(s."dueDate" < current_date, false) AS overdue,
      coalesce(r.n, 0) AS "grnCount", coalesce(r."grnNo", '') AS "lastGrnNo", r.d AS "lastGrnDate", coalesce(r."billNo", '') AS "lastBillNo"
    FROM s LEFT JOIN r ON r.vr = upper(s."orderNo") AND r.sl = s."lineNo"
  )`;
}

/** What the old search box looked in. */
const SEARCHED = ["orderNo", "supplier", "supplierCode", "serviceCode", "serviceName"];

const filterColumn = (key: string) => COLUMNS.find((c) => c.key === key && c.filter);
/** A column as the text its dropdown lists and matches: numbers rounded to 2 places, '' when blank. */
const valueOf = (c: DataColumn<ServiceOrderRow>) =>
  c.kind === "number" ? sql`coalesce(trim_scale(round(${lcol(c.key)}::numeric, 2))::text, '')` : lcol(c.key);

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(query: ServiceOrdersQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const picked = (key: string, date: boolean) => {
    const c = key === skip ? undefined : filterColumn(key);
    return c && (c.kind === "date") === date ? c : undefined;
  };
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    const c = values?.length ? picked(key, false) : undefined;
    if (c) parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${valueOf(c)} = ''` : sql`${valueOf(c)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    const c = value.trim() ? picked(key, false) : undefined;
    if (c) parts.push(contains(valueOf(c), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (!picked(key, true)) continue;
    if (range.from) parts.push(sql`${lcol(key)} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${lcol(key)} <= ${range.to}::date`);
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(Prisma.join(SEARCHED.map(lcol), " || ' ' || "), search));
  if (!query.extra?.showClosed) parts.push(sql`l.open`);
  if (query.extra?.overdueOnly) parts.push(sql`l.overdue`);
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

// Open lines first, the longest pending first; line numbers in number order.
const FALLBACK = sql`f.open DESC, f."daysPending" DESC NULLS LAST, f."orderNo", (CASE WHEN f."lineNo" ~ '^[0-9]{1,9}$' THEN f."lineNo"::int END) NULLS LAST, f.id`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && COLUMNS.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return FALLBACK;
  const c = Prisma.raw(`f."${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(${c}), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${FALLBACK}`;
  return sql`${c} ${Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC")} NULLS LAST, ${FALLBACK}`;
}

const output = (c: DataColumn<ServiceOrderRow>) => {
  const f = Prisma.raw(`f."${c.key}"`);
  if (c.kind === "date") return sql`to_char(${f}, 'YYYY-MM-DD') AS ${Prisma.raw(`"${c.key}"`)}`;
  return c.kind === "number" ? sql`${f}::float8 AS ${Prisma.raw(`"${c.key}"`)}` : f;
};

/** The statements behind one page: its rows, and the count + tile figures of every line the filters keep. */
export function pageSql(query: ServiceOrdersQuery, codes: string[]) {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`WITH ${linesSql(codes)}, f AS (SELECT * FROM l WHERE ${buildWhere(query)})`;
  const out = Prisma.join([sql`f.id`, sql`f."lineNo"`, sql`f.overdue`, ...COLUMNS.map(output)], ", ");
  return {
    rows: sql`${f} SELECT ${out} FROM f ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    kpi: sql`${f} SELECT count(*)::int AS total, (SELECT count(*) FROM l)::int AS "allLines",
      (count(*) FILTER (WHERE open))::int AS "openLines",
      coalesce(sum("pendingValue") FILTER (WHERE open), 0)::float8 AS "pendingValue",
      (count(*) FILTER (WHERE overdue))::int AS "overdueLines",
      (count(*) FILTER (WHERE open AND "daysPending" > 30))::int AS "over30Lines",
      (count(*) FILTER (WHERE open AND "grnCount" = 0))::int AS "noReceiptLines"
      FROM f`,
  };
}

/** The statement behind one dropdown; null for a key that has none. Numbers list smallest first. */
export function facetSql(key: string, query: ServiceOrdersQuery, codes: string[]): Prisma.Sql | null {
  const c = filterColumn(key);
  if (!c || c.kind === "date") return null;
  const order = c.kind === "number" ? sql`min(${lcol(key)}) NULLS FIRST, 1` : sql`1`;
  return sql`WITH ${linesSql(codes)} SELECT ${valueOf(c)} AS v FROM l WHERE ${buildWhere(query, key)} GROUP BY 1 ORDER BY ${order} LIMIT ${FACET_LIMIT}`;
}

/** Upper-cased service codes (quotation DB, written by the service-orders job) and when they were synced. */
async function serviceItems() {
  const items = await prisma.serviceItem.findMany({ select: { itemCode: true, syncedAt: true } });
  // The job replaces the whole list in one transaction, so every row has the same syncedAt.
  return { codes: items.map((i) => i.itemCode.trim().toUpperCase()), syncedAt: items[0]?.syncedAt.toISOString() ?? null };
}

export async function listServiceOrderPage(query: ServiceOrdersQuery): Promise<ServiceOrdersPageData> {
  const { codes, syncedAt } = await serviceItems();
  const q = pageSql(query, codes);
  const [rows, [head]] = await Promise.all([
    stockPrisma.$queryRaw<ServiceOrderRow[]>(q.rows),
    stockPrisma.$queryRaw<Record<string, number>[]>(q.kpi),
  ]);
  const { total, allLines, ...kpi } = head;
  return { rows, total, meta: { kpi, allLines, serviceCodes: codes.length, syncedAt } };
}

/** Distinct values of a column under every other active filter; empty cells come first as BLANK. */
export async function listServiceOrderFacet(key: string, query: ServiceOrdersQuery): Promise<string[]> {
  const q = facetSql(key, query, (await serviceItems()).codes);
  if (!q) return [];
  const values = (await stockPrisma.$queryRaw<{ v: string }[]>(q)).map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
