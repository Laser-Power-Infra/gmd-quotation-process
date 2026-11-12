import "server-only";
import { Prisma, stockPrisma } from "@gmd/db-stock";
import { BLANK, type TableSort } from "@gmd/ui/components/data-table/types";
import { DELIVERY_STATUSES, PO_COLUMNS, type ChartBar, type PoLine, type PoRow, type PurchaseMeta, type PurchasePageData, type PurchaseQuery } from "../poColumns";

// Purchases v2 in SQL: one PO per table row, paged, filtered, faceted and
// totalled on the server. Filters act on PO lines; a PO shows when any of its
// lines match, and its figures cover the matching lines only.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const col = (field: string) => Prisma.raw(`p."${field}"`);
const text = (field: string) => sql`btrim(coalesce(${col(field)}, ''))`;
/** Numeric value of a text cell ("1,000" -> 1000); NULL when not a number. */
const num = (field: string) =>
  sql`(CASE WHEN replace(${text(field)}, ',', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN replace(${text(field)}, ',', '')::numeric END)`;
// Dates arrive as text. Day is added to the 1st so a junk day (31 Feb) rolls over instead of failing the query.
const isoDate = (field: string) =>
  sql`(CASE WHEN ${text(field)} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}$'
    THEN make_date(substr(${text(field)}, 1, 4)::int, substr(${text(field)}, 6, 2)::int, 1) + (substr(${text(field)}, 9, 2)::int - 1) END)`;
const DMY = sql`'^[0-9]{2}-(0[1-9]|1[0-2])-[12][0-9]{3}$'`;
const dmyDate = (field: string) =>
  sql`(CASE WHEN ${text(field)} ~ ${DMY}
    THEN make_date(substr(${text(field)}, 7, 4)::int, substr(${text(field)}, 4, 2)::int, 1) + (substr(${text(field)}, 1, 2)::int - 1) END)`;

// A real sales contract reads like OD23Y-00073. The column also holds NA, NIL, names and stray digits: those are untagged.
const CONTRACT_NO = sql`'^[a-z]{1,4}[0-9]{2}y-[0-9]+$'`;

/** `b`: one typed row per PO line. `l`: plus the fields that depend on today. */
const LINES = sql`b AS (
  SELECT p.id, p."poNo" AS po_no, p."poLineNo" AS line_no,
    ${dmyDate("poDate")} AS po_date,
    CASE WHEN ${text("poDate")} ~ ${DMY} THEN right(${text("poDate")}, 4) ELSE '' END AS po_year,
    ${text("supplierCode")} AS supplier_code,
    ${text("supplierName")} AS supplier,
    CASE WHEN coalesce(${num("exchangeRate")}, 1) NOT IN (0, 1) THEN 'Import' ELSE 'Domestic' END AS origin,
    upper(${text("uom")}) AS uom,
    ${text("itemCode")} AS item_code, p."itemName" AS item_name,
    ${num("netQtyOrder")} AS ordered, ${num("qtyExecuted")} AS received,
    coalesce(p."inTransit", 0)::numeric AS open_qty,
    ${num("rate")} AS rate, ${num("lastPoRate")} AS last_rate, ${num("minPoRate")} AS min_rate,
    coalesce(p."lineValue"::numeric, ${num("netQtyOrder")} * ${num("rate")}) AS ordered_value,
    -- NULL = no usable rate or value on an open line
    coalesce(p."inTransit"::numeric * ${num("rate")}, CASE WHEN p."inTransit" > 0 THEN p."lineValue"::numeric ELSE 0 END) AS open_value_raw,
    ${isoDate("deliverySched")} AS due,
    CASE WHEN ${text("salesContract")} ~* ${CONTRACT_NO} THEN upper(${text("salesContract")}) ELSE '' END AS contract,
    ${text("partyRefNo")} AS party_ref
  FROM "PurchaseOrderLine" p
), l AS (
  SELECT b.*, coalesce(b.open_value_raw, 0) AS open_value,
    CASE WHEN b.open_qty > 0 AND b.due < current_date THEN current_date - b.due END AS days_overdue,
    CASE WHEN b.open_qty <= 0 THEN 'Received' WHEN b.due IS NULL THEN 'No date' WHEN b.due < current_date THEN 'Overdue'
      WHEN b.due <= current_date + 30 THEN 'Due in 30 days' ELSE 'Later' END AS status
  FROM b
)`;

/** Filter key -> line column. */
const FIELDS: Record<string, string> = { poNo: "po_no", supplier: "supplier", origin: "origin", poYear: "po_year", status: "status", contract: "contract" };
const DATES: Record<string, string> = { poDate: "po_date", due: "due" };
const SEARCHED = ["po_no", "item_code", "item_name", "supplier", "contract", "party_ref"];

const lcol = (name: string) => Prisma.raw(`l."${name}"`);
const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(query: PurchaseQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters)) {
    if (key === skip || !values?.length || !FIELDS[key]) continue;
    const c = lcol(FIELDS[key]);
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${c} = ''` : sql`${c} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (key === skip || !value.trim() || !FIELDS[key]) continue;
    parts.push(sql`regexp_replace(${lcol(FIELDS[key])}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`);
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (key === skip || !DATES[key]) continue;
    if (range.from) parts.push(sql`${lcol(DATES[key])} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${lcol(DATES[key])} <= ${range.to}::date`);
  }
  const search = query.search.trim();
  if (search) {
    const all = Prisma.join(SEARCHED.map((c) => sql`coalesce(${lcol(c)}, '')`), " || ' ' || ");
    parts.push(sql`regexp_replace(${all}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(search))}%`}`);
  }
  if (query.extra?.openOnly) parts.push(sql`l.open_qty > 0`);
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

/** `f`: the lines the current query keeps. */
const filtered = (query: PurchaseQuery) => sql`WITH ${LINES}, f AS (SELECT * FROM l WHERE ${buildWhere(query)})`;

// Most overdue first, then the most money still open.
const FALLBACK_ORDER = sql`"daysOverdue" DESC NULLS LAST, "openValue" DESC, "poNo" ASC`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && PO_COLUMNS.find((c) => c.key === sort.key);
  if (!sort || !column?.sortable) return FALLBACK_ORDER;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  const c = Prisma.raw(`"${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(${c}), '') ${dir} ${Prisma.raw(sort.dir === "asc" ? "NULLS LAST" : "NULLS FIRST")}, ${FALLBACK_ORDER}`;
  return sql`${c} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
}

const STATUS_ARRAY = Prisma.raw(`ARRAY[${DELIVERY_STATUSES.map((s) => `'${s}'`).join(",")}]`);
const day = (c: string) => Prisma.raw(`to_char(${c}, 'YYYY-MM-DD')`);

/** The statements behind one page. */
export function pageSql(query: PurchaseQuery) {
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const offset = Math.max(0, query.page - 1) * pageSize;
  const f = filtered(query);
  return {
    rows: sql`${f}, po AS (
        SELECT po_no AS "poNo", min(po_date) AS "poDate", min(supplier_code) AS "supplierCode", min(supplier) AS supplier, min(origin) AS origin,
          count(*)::int AS lines, (count(*) FILTER (WHERE open_qty > 0))::int AS "openLines",
          coalesce(sum(ordered_value), 0)::float AS "orderedValue", sum(open_value)::float AS "openValue",
          least(100, 100 * sum(coalesce(received, 0) * coalesce(rate, 1)) / nullif(sum(ordered * coalesce(rate, 1)), 0))::float AS "receivedPct",
          min(due) FILTER (WHERE open_qty > 0) AS due, max(days_overdue)::int AS "daysOverdue",
          (${STATUS_ARRAY})[min(array_position(${STATUS_ARRAY}, status))] AS status,
          string_agg(DISTINCT nullif(contract, ''), ', ') AS contract
        FROM f GROUP BY po_no
      )
      SELECT po."poNo", ${day(`po."poDate"`)} AS "poDate", po."supplierCode", po.supplier, po.origin, po.lines, po."openLines",
        po."orderedValue", po."openValue", po."receivedPct", ${day("po.due")} AS due, po."daysOverdue", po.status, po.contract,
        (SELECT string_agg(trim_scale(round(u.q, 3))::text || ' ' || u.uom, ', ' ORDER BY u.uom)
           FROM (SELECT uom, sum(open_qty) AS q FROM f WHERE f.po_no = po."poNo" AND open_qty > 0 GROUP BY uom) u) AS balance
      FROM po ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    kpi: sql`${f} SELECT count(DISTINCT po_no)::int AS total,
        (count(*) FILTER (WHERE open_qty > 0))::int AS "openLines",
        coalesce(sum(ordered_value) FILTER (WHERE open_qty > 0), 0)::float AS "openPoValue",
        coalesce(sum(open_value), 0)::float AS "inTransitValue",
        (count(*) FILTER (WHERE status = 'Overdue'))::int AS "overdueLines",
        coalesce(sum(open_value) FILTER (WHERE status = 'Overdue'), 0)::float AS "overdueValue",
        (count(*) FILTER (WHERE status = 'Due in 30 days'))::int AS "due30Lines",
        coalesce(sum(open_value) FILTER (WHERE status = 'Due in 30 days'), 0)::float AS "due30Value",
        (count(DISTINCT supplier_code) FILTER (WHERE open_qty > 0))::int AS suppliers,
        (count(*) FILTER (WHERE open_qty > 0 AND contract = ''))::int AS "untaggedLines",
        coalesce(sum(open_value) FILTER (WHERE open_qty > 0 AND contract = ''), 0)::float AS "untaggedValue",
        (count(*) FILTER (WHERE open_qty > 0 AND open_value_raw IS NULL))::int AS "blankValueLines",
        (SELECT max("syncedAt") FROM "PurchaseOrderLine") AS "syncedAt"
      FROM f`,
    ageing: sql`${f} SELECT CASE WHEN status <> 'Overdue' THEN 'Not due' WHEN days_overdue <= 30 THEN '0-30' WHEN days_overdue <= 90 THEN '31-90' WHEN days_overdue <= 180 THEN '91-180' ELSE '180+' END AS label,
        sum(open_value)::float AS value, count(*)::int AS lines
      FROM f WHERE open_qty > 0 GROUP BY 1`,
    suppliers: sql`${f} SELECT supplier_code AS code, min(supplier) AS label, sum(open_value)::float AS value, count(*)::int AS lines
      FROM f WHERE open_qty > 0 GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 10`,
    monthly: sql`${f} SELECT CASE WHEN due IS NULL THEN 'No date' WHEN due < date_trunc('month', current_date) THEN 'Earlier' ELSE to_char(due, 'YYYY-MM') END AS label,
        sum(open_value)::float AS value, count(*)::int AS lines
      FROM f WHERE open_qty > 0 GROUP BY 1 ORDER BY 1`,
  };
}

type KpiRow = PurchaseMeta["kpi"] & { total: number; syncedAt: Date | null };

export async function listPurchasePoPage(query: PurchaseQuery): Promise<PurchasePageData> {
  const q = pageSql(query);
  const [rows, [kpiRow], ageing, suppliers, monthly] = await Promise.all([
    stockPrisma.$queryRaw<PoRow[]>(q.rows),
    stockPrisma.$queryRaw<KpiRow[]>(q.kpi),
    stockPrisma.$queryRaw<ChartBar[]>(q.ageing),
    stockPrisma.$queryRaw<ChartBar[]>(q.suppliers),
    stockPrisma.$queryRaw<ChartBar[]>(q.monthly),
  ]);
  const { total, syncedAt, ...kpi } = kpiRow;
  return { rows, total, meta: { kpi, ageing, suppliers, monthly, syncedAt: syncedAt ? syncedAt.toISOString() : null } };
}

/** Distinct values of a filter key under every other active filter; empty cells come first as BLANK. */
export async function listPurchaseFacet(key: string, query: PurchaseQuery): Promise<string[]> {
  if (!FIELDS[key]) return [];
  const rows = await stockPrisma.$queryRaw<{ v: string }[]>`WITH ${LINES}
    SELECT DISTINCT ${lcol(FIELDS[key])} AS v FROM l WHERE ${buildWhere(query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}

/** The lines of one PO that the current filters keep, in line order. */
export async function listPurchaseLines(poNo: string, query: PurchaseQuery): Promise<PoLine[]> {
  return stockPrisma.$queryRaw<PoLine[]>`${filtered(query)}
    SELECT id, line_no AS "lineNo", item_code AS "itemCode", item_name AS "itemName", uom,
      ordered::float AS ordered, received::float AS received, open_qty::float AS balance,
      rate::float AS rate, last_rate::float AS "lastRate", min_rate::float AS "minRate",
      open_value_raw::float AS "openValue", ${day("due")} AS due, days_overdue::int AS "daysOverdue", status, contract
    FROM f WHERE po_no = ${poNo}
    ORDER BY CASE WHEN line_no ~ '^[0-9]+$' THEN line_no::int END NULLS LAST, line_no`;
}
