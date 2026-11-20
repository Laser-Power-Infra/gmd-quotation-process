import "server-only";
import { Prisma, prisma } from "@gmd/db-tender";
import { BLANK, type TablePage, type TableSort } from "@gmd/ui/components/data-table/types";
import { DRAWING_COLUMNS, NO_DRAWINGS, STATUS_ORDER, type DrawingRow, type DrawingStatus, type DrawingsQuery } from "../columns";

// The Drawings page in SQL: one row per current (not superseded) drawing plus one "No drawings" row
// per live contract that has none, paged, filtered, faceted and sorted on the server. CTE `l` names
// its columns by the column keys, so only keys listed in ../columns ever reach the SQL.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;
const FACETS = new Set(DRAWING_COLUMNS.filter((c) => c.filter).map((c) => c.key));
const SEARCHED = ["contractNo", "contractor", "client", "project", "poNo", "drawingNo", "product"];
const SUPERSEDED: DrawingStatus = "Superseded";
const APPROVED: DrawingStatus = "Approved by client";

/** A contract no (or item code) column as a key, the SQL twin of contractKey in ../columns. */
// shortcut: computed over every ContractReview line on each page, facet, lookup and sync (the table has no index); add a stored key column + index if they get slow.
export const contractKeySql = (column: Prisma.Sql) => sql`upper(btrim(regexp_replace(coalesce(${column}, ''), '[[:space:]]+', ' ', 'g')))`;
const lcol = (key: string) => Prisma.raw(`l."${key}"`);
const fcol = (key: string) => Prisma.raw(`f."${key}"`);
// The first filled value in item-code order: the same pick getContractDrawings makes for its header.
const filled = (column: string) => {
  const v = sql`nullif(btrim(r.${Prisma.raw(`"${column}"`)}), '')`;
  return sql`coalesce((array_agg(${v} ORDER BY r."itemCode", r.id) FILTER (WHERE ${v} IS NOT NULL))[1], '')`;
};

const LINES = sql`c AS (
    SELECT ${contractKeySql(sql`r."contractNo"`)} AS "contractNo", ${filled("partyNameDump")} AS "contractor",
      ${filled("utility")} AS "client", ${filled("projectReference")} AS "project", ${filled("poNo")} AS "poNo",
      ${filled("dateOfContract")} AS "contractDate", bool_or(btrim(coalesce(r."status", '')) = '') AS "live"
    FROM "ContractReview" r GROUP BY 1
  ), l AS (
    SELECT d.id, d."contractNo", coalesce(c."contractor", '') AS "contractor", coalesce(c."client", '') AS "client",
      coalesce(c."project", '') AS "project", coalesce(c."poNo", '') AS "poNo", coalesce(c."contractDate", '') AS "contractDate",
      d."drawingNo", d."rev", d."docType", coalesce(d."product", '') AS "product", d."status",
      (now() AT TIME ZONE 'Asia/Kolkata')::date - ((d."statusAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS "daysAtStage",
      coalesce(d."preparedBy", '') AS "owner", d."statusBy" AS "changedBy"
    FROM "ContractDrawing" d LEFT JOIN c ON c."contractNo" = d."contractNo" WHERE d."status" <> ${SUPERSEDED}
    UNION ALL
    SELECT 'contract:' || c."contractNo", c."contractNo", c."contractor", c."client", c."project", c."poNo", c."contractDate",
      '', NULL::int, '', '', ${NO_DRAWINGS}::text, NULL::int, '', ''
    FROM c WHERE c."live" AND c."contractNo" <> '' AND NOT EXISTS (SELECT 1 FROM "ContractDrawing" x WHERE x."contractNo" = c."contractNo")
  )`;

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`; `skip` drops one facet's own selection so its list keeps every option. */
function buildWhere(query: DrawingsQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (key === skip || !FACETS.has(key) || !values?.length) continue;
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${lcol(key)} = ''` : sql`${lcol(key)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (key !== skip && FACETS.has(key) && value.trim()) parts.push(contains(lcol(key), value));
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(Prisma.join(SEARCHED.map(lcol), " || ' ' || "), search));
  if (query.extra?.pending === true) parts.push(sql`l."status" NOT IN (${NO_DRAWINGS}, ${APPROVED})`);
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

const FALLBACK = sql`f."contractNo", f."drawingNo", f.id`;
const flowOrder = (column: Prisma.Sql) => sql`array_position(${STATUS_ORDER}::text[], ${column})`;

function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && DRAWING_COLUMNS.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return FALLBACK;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  if (column.key === "status") return sql`${flowOrder(fcol("status"))} ${dir}, ${FALLBACK}`;
  if (column.kind === "text") return sql`NULLIF(lower(${fcol(column.key)}), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${FALLBACK}`;
  return sql`${fcol(column.key)} ${dir} NULLS LAST, ${FALLBACK}`;
}

const OUT = Prisma.join([sql`f.id`, ...DRAWING_COLUMNS.map((c) => fcol(c.key))], ", ");

export async function listDrawingsPage(query: DrawingsQuery): Promise<TablePage<DrawingRow>> {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`WITH ${LINES}, f AS (SELECT * FROM l WHERE ${buildWhere(query)})`;
  const [rows, [head]] = await Promise.all([
    prisma.$queryRaw<DrawingRow[]>(sql`${f} SELECT ${OUT} FROM f ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`),
    prisma.$queryRaw<{ total: number }[]>(sql`${f} SELECT count(*)::int AS total FROM f`),
  ]);
  return { rows, total: Number(head?.total ?? 0) };
}

/** Distinct values of a facet column under every other active filter; empty cells come first as BLANK. */
export async function listDrawingsFacet(key: string, query: DrawingsQuery): Promise<string[]> {
  if (!FACETS.has(key)) return [];
  const order = key === "status" ? flowOrder(lcol(key)) : sql`1`;
  const rows = await prisma.$queryRaw<{ v: string }[]>(
    sql`WITH ${LINES} SELECT ${lcol(key)} AS v FROM l WHERE ${buildWhere(query, key)} GROUP BY 1 ORDER BY ${order} LIMIT ${FACET_LIMIT}`,
  );
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
