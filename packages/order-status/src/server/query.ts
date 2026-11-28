import "server-only";
import { Prisma, prisma } from "@gmd/db-tender";
import { prisma as quotationPrisma } from "@gmd/db-quotation";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { ORDER_COLUMNS, PENDING_WITH, STAGES, type ContractDetail, type ContractLineRow, type ContractRow, type OrderStatusPageData, type Stage } from "../columns";

// Order Status in SQL: ContractReview lines (`lines`) rolled up to one row per contract (`c`), whose
// columns are named by the column keys, so filters, facets and sorts address them by key and only
// keys listed in ../columns reach the SQL. Paged, filtered, faceted and counted on the server.
// No auth here: the host's actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

/** Quoted identifier; only ever called with constants and keys from ../columns. */
const ident = (name: string) => Prisma.raw(`"${name}"`);
const ccol = (key: string) => Prisma.raw(`c."${key}"`);
const text = (column: string) => sql`btrim(coalesce(${Prisma.raw(column)}, ''))`;
/** parseFloat of a sheet cell ("1,200" -> 1200, "12 nos" -> 12); NULL when it does not start with a number. */
const num = (column: string) =>
  sql`substring(replace(${text(column)}, ',', '') FROM '^[-+]?(?:[0-9]+[.]?[0-9]*|[.][0-9]+)(?:[eE][-+]?[0-9]{1,2})?')::float8`;
/** A quantity: 0 when the cell is not a number. */
const qty = (column: string) => sql`coalesce(${num(column)}, 0)`;
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

const entry = sql`(${num('c."prodOrdQty"')} - ${num('c."balanceToProdEnt"')})`;

/**
 * One row per ContractReview line. `stageNo` indexes STAGES: the first unmet step. A partly billed
 * line shows as Bill / Dispatch for its whole qty. Prod entry qty = prod order qty − balance to prod
 * entry, NULL when either is unknown or the result is negative (@gmd/contract-review prodEntryQty).
 */
const LINES = sql`SELECT x.*, CASE
    WHEN x."orderQty" > 0 AND x."billedQty" >= x."orderQty" THEN 5
    WHEN x."diQty" > x."billedQty" OR (cardinality(x."diDate") > 0 AND x."billedQty" < x."orderQty") THEN 4
    WHEN cardinality(x."inspectionNumber") > 0 THEN 3
    WHEN cardinality(x."offerNumber") > 0 THEN 2
    WHEN x."prodOrdQty" > 0 OR coalesce(x."productionOrderNumber", '') <> '' THEN 1
    ELSE 0 END AS "stageNo"
  FROM (SELECT c.id, c."contractNo",
      coalesce(nullif(${text('c."partyNameDump"')}, ''), ${text('c."erpPartyNameFromGmdSupplyHistory"')}) AS "party",
      c."itemCode", coalesce(nullif(${text('c."itemName"')}, ''), ${text('c."partyItemName"')}) AS "itemName",
      ${day('c."dateOfContract"')} AS "contractDate", ${qty('c."rate"')} AS "rate",
      ${qty('c."orderQty"')} AS "orderQty", ${qty('c."mcQty"')} AS "mcQty", ${qty('c."prodOrdQty"')} AS "prodOrdQty",
      ${qty('c."diQty"')} AS "diQty", ${qty('c."billedQty"')} AS "billedQty",
      CASE WHEN ${entry} >= 0 THEN ${entry} END AS "prodEntryQty",
      c."prodEntryDate", ${day('c."prodEntryDate"')} AS "prodEntryDay",
      c."productionOrderNumber", c."offerNumber", c."inspectionNumber", c."diDate"
    FROM "ContractReview" c) x`;

/** The value of a per-stage list at the contract's stage. */
const atStage = (list: readonly string[]) => sql`(${[...list]}::text[])[min(l."stageNo") + 1]`;
const known = sql`l."prodEntryQty" IS NOT NULL AND l."prodOrdQty" > 0`;
// Contracts are dated in India: count days on its calendar.
const TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

/** One row per contract: it sits at its least-advanced line. */
const CONTRACTS = sql`SELECT l."contractNo" AS id, l."contractNo", max(l."party") AS "party", min(l."contractDate") AS "contractDate",
    ${TODAY} - min(l."contractDate") AS "days", count(*)::int AS "items", sum(l."orderQty" * l."rate") AS "value",
    min(l."stageNo") AS "stageNo", ${atStage(STAGES)} AS "stage", ${atStage(STAGES.map((s) => PENDING_WITH[s]))} AS "pendingWith",
    sum(l."prodEntryQty") FILTER (WHERE ${known}) AS "producedQty", sum(l."prodOrdQty") FILTER (WHERE ${known}) AS "producedOf",
    (array_agg(l."prodEntryDate" ORDER BY l."prodEntryDay" DESC) FILTER (WHERE l."prodEntryDay" IS NOT NULL))[1] AS "lastEntry",
    string_agg(l."itemCode" || ' ' || l."itemName", ' ') AS "itemText"
  FROM lines l GROUP BY l."contractNo"`;

const WITH = sql`WITH lines AS (${LINES}), c AS (${CONTRACTS})`;

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `c`; `skip` drops one key's own filter so its facet (or the stage tiles) keep every option. */
export function buildWhere(query: TableQuery, skip?: string): Prisma.Sql {
  const filterable = (key: string, date: boolean) =>
    key !== skip && ORDER_COLUMNS.some((c) => c.key === key && c.filter && (c.kind === "date") === date);
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (!values?.length || !filterable(key, false)) continue;
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${ccol(key)} = ''` : sql`${ccol(key)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value.trim() && filterable(key, false)) parts.push(contains(ccol(key), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (!filterable(key, true)) continue;
    if (range.from) parts.push(sql`${ccol(key)} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${ccol(key)} <= ${range.to}::date`);
  }
  // Fully billed contracts stay out until asked for: the "Show fully billed" toggle, or a stage picked.
  const stagePicked = Boolean(query.filters?.stage?.length || query.columnSearch?.stage?.trim());
  if (skip !== "stage" && !stagePicked && query.extra?.showDone !== true) parts.push(sql`c."stageNo" < ${STAGES.length - 1}`);
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(sql`c."contractNo" || ' ' || c."party" || ' ' || coalesce(c."itemText", '')`, search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

/** Oldest contract first, as before any sort. */
const FALLBACK = sql`f."contractDate" ASC NULLS LAST, f."contractNo"`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && ORDER_COLUMNS.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return FALLBACK;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  if (column.key === "stage") return sql`f."stageNo" ${dir}, ${FALLBACK}`;
  const c = Prisma.raw(`f."${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(${c}), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${FALLBACK}`;
  return sql`${c} ${dir} NULLS LAST, ${FALLBACK}`;
}

/** The statements behind one page: its rows, and the count + per-stage figures of every contract the filters keep. */
export function pageSql(query: TableQuery) {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  return {
    rows: sql`${WITH}, f AS (SELECT * FROM c WHERE ${buildWhere(query)})
      SELECT f.id, f."contractNo", f."party", to_char(f."contractDate", 'YYYY-MM-DD') AS "contractDate", f."days", f."items", f."value",
        f."stage", f."pendingWith", f."producedQty", f."producedOf", f."lastEntry"
      FROM f ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    // Stage counts skip the stage filter (and the fully-billed rule) so every tile keeps its figure; `total` applies them all.
    head: sql`${WITH} SELECT (count(*) FILTER (WHERE ${buildWhere(query)}))::int AS total,
      ${Prisma.join(STAGES.map((s, i) => sql`(count(*) FILTER (WHERE c."stageNo" = ${i}))::int AS ${ident(s)}`), ", ")},
      (SELECT max("syncedAt") FROM "ContractReview") AS "syncedAt"
      FROM c WHERE ${buildWhere(query, "stage")}`,
  };
}

export async function listOrderStatusPage(query: TableQuery): Promise<OrderStatusPageData> {
  const q = pageSql(query);
  const [rows, [head]] = await Promise.all([prisma.$queryRaw<ContractRow[]>(q.rows), prisma.$queryRaw<Record<string, unknown>[]>(q.head)]);
  const { total, syncedAt, ...stages } = head;
  return {
    rows,
    total: Number(total),
    meta: { stages: stages as Record<Stage, number>, syncedAt: syncedAt instanceof Date ? syncedAt.toISOString() : null },
  };
}

/** Distinct values of a text filter under every other active filter; stages in step order, empty cells first as BLANK. */
export async function listOrderStatusFacet(key: string, query: TableQuery): Promise<string[]> {
  if (!ORDER_COLUMNS.some((c) => c.key === key && c.filter && c.kind === "text")) return [];
  const order = key === "stage" ? sql`min(c."stageNo")` : sql`1`;
  const rows = await prisma.$queryRaw<{ v: string }[]>`${WITH}
    SELECT ${ccol(key)} AS v FROM c WHERE ${buildWhere(query, key)} GROUP BY 1 ORDER BY ${order} LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}

type LineOut = Omit<ContractLineRow, "stage"> & { stageNo: number };

/** The drill-down: the contract's lines (ContractReview) and the invoices raised against it (Supply History). */
export async function getContractDetail(contractNo: string): Promise<ContractDetail> {
  const [lines, invoices] = await Promise.all([
    prisma.$queryRaw<LineOut[]>`WITH lines AS (${LINES})
      SELECT l.id, l."itemCode", l."itemName", l."orderQty", l."mcQty", l."prodOrdQty", l."diQty", l."billedQty",
        l."productionOrderNumber", l."offerNumber", l."inspectionNumber", l."diDate", l."stageNo"
      FROM lines l WHERE l."contractNo" = ${contractNo} ORDER BY l.id`,
    quotationPrisma.supplyHistoryItem.findMany({
      where: { erpContractNo: { equals: contractNo.trim(), mode: "insensitive" } },
      select: { invoiceNo: true, date: true, itemName: true, erpItemCode: true, quantity: true, value: true, lrNoDt: true, orderCopy: true, invoice: true, inspectionReport: true },
      orderBy: { invoiceNo: "asc" },
    }),
  ]);
  return {
    lines: lines.map(({ stageNo, ...l }) => ({ ...l, stage: STAGES[stageNo] })),
    invoices: invoices.map(({ erpItemCode, quantity, ...r }) => ({ ...r, itemCode: erpItemCode, qty: quantity })),
  };
}

type ExportOut = Pick<ContractLineRow, "itemCode" | "itemName" | "orderQty" | "mcQty" | "prodOrdQty" | "diQty" | "billedQty" | "productionOrderNumber"> &
  Pick<ContractRow, "contractNo" | "party" | "contractDate"> & { stageNo: number; offers: string; inspections: string; diDates: string };

/** Every line of every contract the query keeps, in the page's order, as EXPORT_HEADER rows. */
export async function listOrderStatusExport(query: TableQuery): Promise<(string | number | null)[][]> {
  const rows = await prisma.$queryRaw<ExportOut[]>`${WITH}, f AS (SELECT * FROM c WHERE ${buildWhere(query)})
    SELECT f."contractNo", f."party", to_char(f."contractDate", 'YYYY-MM-DD') AS "contractDate", l."itemCode", l."itemName",
      l."orderQty", l."mcQty", l."prodOrdQty", l."diQty", l."billedQty", l."stageNo", l."productionOrderNumber",
      array_to_string(l."offerNumber", ', ') AS "offers", array_to_string(l."inspectionNumber", ', ') AS "inspections",
      array_to_string(l."diDate", ', ') AS "diDates"
    FROM f JOIN lines l ON l."contractNo" = f."contractNo" ORDER BY ${buildOrderBy(query.sort)}, l.id`;
  return rows.map((r) => [
    r.contractNo, r.party, r.contractDate, r.itemCode, r.itemName, r.orderQty, r.mcQty, r.prodOrdQty, r.diQty, r.billedQty,
    STAGES[r.stageNo], PENDING_WITH[STAGES[r.stageNo]], r.productionOrderNumber, r.offers || "-", r.inspections || "-", r.diDates || "-",
  ]);
}
