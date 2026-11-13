import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { REGISTERS, isRegisterKey, type RegisterKey, type RegisterPageData, type RegisterRow } from "../columns";

// The registers in SQL: paged, filtered, faceted and totalled on the server. Each register is one
// CTE `l` whose columns are named by its column keys, so filters, facets and sorts address them by
// key, and only keys listed in ../columns ever reach the SQL. No auth here: the host's actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

/** Quoted identifier; only ever called with keys from ../columns. */
const ident = (name: string) => Prisma.raw(`"${name}"`);
const lcol = (key: string) => Prisma.raw(`l."${key}"`);
const text = (column: string) => sql`btrim(coalesce(${Prisma.raw(column)}, ''))`;
/** Numeric value of a text cell ("1,000" -> 1000); NULL when not a number. */
const num = (column: string) =>
  sql`(CASE WHEN replace(${text(column)}, ',', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN replace(${text(column)}, ',', '')::float8 END)`;
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

interface RegisterSql {
  /** One row per line, columns named by the register's column keys; filterable text is never NULL. */
  lines: Prisma.Sql;
  /** Column keys the search box looks in. */
  searched: readonly string[];
  /** Default order, and the tie-break after a column sort. */
  fallback: Prisma.Sql;
  /** Aggregates over `f`, named by the register's KPI keys. */
  kpi: Prisma.Sql;
  /** When the copy behind the register was last written. */
  syncedAt: Prisma.Sql;
}

const SQL: Record<RegisterKey, RegisterSql> = {
  // Supply History holds one row per invoice + item, filled by MASTER and the SALE BILL sync.
  dispatch: {
    lines: sql`SELECT s.id, ${text('s."invoiceNo"')} AS "invoiceNo", ${day('s."date"')} AS "invoiceDate",
        ${text('s."financialYear"')} AS "fy",
        coalesce(nullif(${text('s."erpPartyName"')}, ''), nullif(${text('s."consigneeName"')}, ''), ${text('s."partyName"')}) AS "party",
        ${text('s."erpContractNo"')} AS "contractNo", ${text('s."partyOrderNo"')} AS "partyOrderNo",
        ${text('s."erpItemCode"')} AS "itemCode", s."itemName" AS "itemName",
        ${num('s."quantity"')} AS "qty", upper(${text('s."uom"')}) AS "uom", ${num('s."value"')} AS "value",
        ${text('s."lrNoDt"')} AS "lrNoDt",
        CASE WHEN ${text('s."lrNoDt"')} IN ('', '-', '--', '—', '–') THEN 'LR pending' ELSE 'LR entered' END AS "lrStatus",
        ${text('s."consigneeName"')} AS "consignee", ${text('s."deliveryDestination"')} AS "destination", ${text('s."state"')} AS "state"
      FROM "SupplyHistoryItem" s`,
    searched: ["invoiceNo", "party", "contractNo", "partyOrderNo", "itemCode", "itemName", "lrNoDt", "consignee", "destination"],
    fallback: sql`f."invoiceDate" DESC NULLS LAST, f."invoiceNo" DESC, f.id`,
    kpi: sql`count(DISTINCT "invoiceNo")::int AS "invoices", coalesce(sum("value"), 0)::float AS "value",
      (count(DISTINCT "invoiceNo") FILTER (WHERE "lrStatus" = 'LR pending'))::int AS "lrPending",
      count(DISTINCT nullif("party", ''))::int AS "parties"`,
    // The last completed SALE BILL run, the heartbeat the Sales Register shows too.
    syncedAt: sql`(SELECT "syncedAt" FROM engineering_sync WHERE "tabKey" = 'execution-tracking')`,
  },
  mc: {
    lines: sql`SELECT m.id, m."mcNo", CASE WHEN m."slNo" ~ '^[0-9]{1,9}$' THEN m."slNo"::int END AS "slNo",
        coalesce(m."contractNo", '') AS "contractNo", coalesce(m."party", '') AS "party", coalesce(m."itemCode", '') AS "itemCode",
        m."itemName", m."partyItemName", coalesce(m."bomId", '') AS "bomId",
        m."orderedQty", m."cancelledQty", m."billedQty", m."balanceQty", m."rate", m."balanceQty" * m."rate" AS "balanceValue",
        m."inspOfferedQty", m."inspectedQty", m."status"
      FROM "McRegisterLine" m`,
    searched: ["mcNo", "contractNo", "party", "itemCode", "itemName", "partyItemName", "bomId"],
    // The most money still open first; the MC tab has no date to order by.
    fallback: sql`f."balanceValue" DESC NULLS LAST, f."mcNo" DESC, f."slNo" NULLS LAST, f.id`,
    kpi: sql`count(DISTINCT "mcNo")::int AS "mcs", (count(*) FILTER (WHERE "status" = 'Open'))::int AS "openLines",
      coalesce(sum("balanceValue") FILTER (WHERE "status" = 'Open'), 0)::float AS "openValue",
      coalesce(sum("billedQty" * "rate"), 0)::float AS "billedValue"`,
    syncedAt: sql`(SELECT max("syncedAt") FROM "McRegisterLine")`,
  },
  // Contract and party come from the MC the production order was raised against.
  production: {
    lines: sql`SELECT p.id, p."prodOrderNo", ${day('p."prodOrderDate"')} AS "prodOrderDate", coalesce(p."mcNo", '') AS "mcNo",
        coalesce(mc."contractNo", '') AS "contractNo", coalesce(mc."party", '') AS "party",
        p."itemCode", p."itemName", coalesce(p."bomId", '') AS "bomId",
        p."orderedQty", p."producedQty", p."balanceQty", p."entries", ${day('p."lastEntryDate"')} AS "lastEntryDate", p."status"
      FROM "ProductionRegisterLine" p
      LEFT JOIN (SELECT DISTINCT ON ("mcNo") "mcNo", "contractNo", "party" FROM "McRegisterLine"
        ORDER BY "mcNo", "contractNo" NULLS LAST) mc ON mc."mcNo" = p."mcNo"`,
    searched: ["prodOrderNo", "mcNo", "contractNo", "party", "itemCode", "itemName", "bomId"],
    fallback: sql`f."prodOrderDate" DESC NULLS LAST, f."prodOrderNo" DESC, f.id`,
    kpi: sql`count(DISTINCT "prodOrderNo")::int AS "orders", (count(*) FILTER (WHERE "status" = 'Pending'))::int AS "pending",
      coalesce(sum("balanceQty") FILTER (WHERE "status" = 'Pending'), 0)::float AS "pendingQty",
      coalesce(sum("producedQty"), 0)::float AS "producedQty"`,
    syncedAt: sql`(SELECT max("syncedAt") FROM "ProductionRegisterLine")`,
  },
};

function defOf(register: RegisterKey) {
  if (!isRegisterKey(register)) throw new Error(`Unknown register: ${String(register)}`);
  return { ...REGISTERS[register], ...SQL[register] };
}

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(register: RegisterKey, query: TableQuery, skip?: string): Prisma.Sql {
  const { columns, searched } = defOf(register);
  const filterable = (key: string, date: boolean) => key !== skip && columns.some((c) => c.key === key && c.filter && (c.kind === "date") === date);
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (!values?.length || !filterable(key, false)) continue;
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${lcol(key)} = ''` : sql`${lcol(key)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value.trim() && filterable(key, false)) parts.push(contains(lcol(key), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (!filterable(key, true)) continue;
    if (range.from) parts.push(sql`${lcol(key)} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${lcol(key)} <= ${range.to}::date`);
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(Prisma.join(searched.map((k) => sql`coalesce(${lcol(k)}, '')`), " || ' ' || "), search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

export function buildOrderBy(register: RegisterKey, sort: TableSort | null): Prisma.Sql {
  const { columns, fallback } = defOf(register);
  const column = sort && columns.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return fallback;
  const c = Prisma.raw(`f."${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(${c}), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${fallback}`;
  return sql`${c} ${Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC")} NULLS LAST, ${fallback}`;
}

/** The statements behind one page: its rows, and the count + totals of every line the filters keep. */
export function pageSql(register: RegisterKey, query: TableQuery) {
  const def = defOf(register);
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`WITH l AS (${def.lines}), f AS (SELECT * FROM l WHERE ${buildWhere(register, query)})`;
  const out = Prisma.join(
    [sql`f.id`, ...def.columns.map((c) => (c.kind === "date" ? sql`to_char(f.${ident(c.key)}, 'YYYY-MM-DD') AS ${ident(c.key)}` : sql`f.${ident(c.key)}`))],
    ", ",
  );
  return {
    rows: sql`${f} SELECT ${out} FROM f ORDER BY ${buildOrderBy(register, query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    kpi: sql`${f} SELECT count(*)::int AS total, ${def.kpi}, ${def.syncedAt} AS "syncedAt" FROM f`,
  };
}

export async function listRegisterPage(register: RegisterKey, query: TableQuery): Promise<RegisterPageData> {
  const q = pageSql(register, query);
  const [rows, [head]] = await Promise.all([prisma.$queryRaw<RegisterRow[]>(q.rows), prisma.$queryRaw<Record<string, unknown>[]>(q.kpi)]);
  const { total, syncedAt, ...kpi } = head;
  return {
    rows,
    total: Number(total),
    meta: { kpi: kpi as Record<string, number>, syncedAt: syncedAt instanceof Date ? syncedAt.toISOString() : null },
  };
}

/** Distinct values of a text filter under every other active filter; empty cells come first as BLANK. */
export async function listRegisterFacet(register: RegisterKey, key: string, query: TableQuery): Promise<string[]> {
  const def = defOf(register);
  if (!def.columns.some((c) => c.key === key && c.filter && c.kind === "text")) return [];
  const rows = await prisma.$queryRaw<{ v: string }[]>`WITH l AS (${def.lines})
    SELECT DISTINCT ${lcol(key)} AS v FROM l WHERE ${buildWhere(register, query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
