import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { stockPrisma } from "@gmd/db-stock";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { ERP_DIFFERS, NEEDS_CODE, VIEWS, isViewKey, type PageData, type PageMeta, type Row, type SuitCode, type ViewKey } from "../columns";

// The three views in SQL: paged, filtered, faceted and totalled on the server. Each view reads one
// CTE `l` whose columns are named by its column keys, so filters, facets and sorts address them by
// key, and only keys listed in ../columns ever reach the SQL. Live Physical Stock is in the stock
// database: it is read once per request and joined in as the `live` CTE (ERP code -> available qty).
// No auth here: the host's actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;
const STOCK_ERROR = "Live stock could not be read. Quantities are not shown.";

/** Quoted column of `l`; only ever called with keys from ../columns. */
const lcol = (key: string) => Prisma.raw(`l."${key}"`);
/** A cell as facets list it and filters match it: numbers in Postgres' text form, NULL as ''. */
const cell = (key: string) => sql`btrim(coalesce(${lcol(key)}::text, ''))`;

/** Live available qty per ERP code; a code Physical Stock does not hold is absent (0). */
type Live = ReadonlyMap<string, number>;
const withLive = (live: Live) =>
  sql`WITH live(code, qty) AS (SELECT * FROM unnest(${[...live.keys()]}::text[], ${[...live.values()]}::float8[]))`;

interface ViewSql {
  /** One row per line, columns named by the view's column keys. */
  lines: Prisma.Sql;
  /** Column keys the search box looks in. */
  searched: readonly string[];
  /** Default order, and the tie-break after a column sort. */
  fallback: Prisma.Sql;
  /** Aggregates over `f`, named by the view's KPI keys. */
  kpi?: Prisma.Sql;
  /** Live qty columns: blank, not 0, when Physical Stock could not be read. */
  live: readonly string[];
}

const MAPPING: ViewSql = {
  // K-series qty: every Rotork stock line of the in-stock rating. GMD gearbox qty: its own ERP code.
  lines: sql`SELECT m."mapKey" AS id, m."valveType", m."dn", m."pn", m."requiredTorque", m."gearbox", m."actInputTorque",
      m."aumaModel", m."rotorkModel", m."stockRotorkNm",
      CASE WHEN m."stockRotorkNm" IS NOT NULL THEN coalesce((SELECT sum(v.qty) FROM "ActuatorStock" a JOIN live v ON v.code = a."erpCode"
        WHERE a."make" = 'Rotork' AND a."torque" = m."stockRotorkNm"), 0) END AS "rotorkAvailable",
      m."valveFlange", m."flangeCheck", m."gmdGbCode", m."gmdGbRating",
      CASE WHEN m."gmdGbCode" <> '' THEN coalesce((SELECT v.qty FROM live v WHERE v.code = m."gmdGbCode"), 0) END AS "gmdGbAvailable"
    FROM "ActuatorMapping" m`,
  searched: ["valveType", "dn", "pn", "gearbox", "aumaModel", "rotorkModel", "valveFlange", "flangeCheck", "gmdGbCode"],
  fallback: sql`f."valveType", f."dn", f."pn", f.id`,
  live: ["rotorkAvailable", "gmdGbAvailable"],
};

const SQL: Record<ViewKey, ViewSql> = {
  mapping: MAPPING,
  // The matrix rows are the mapping rows; its marks are read for the page in listPage.
  suitability: { ...MAPPING, searched: ["valveType", "dn", "pn"], live: [] },
  // The old mismatch report's checks: ERP vs physical stock (blank counts 0, as the workbook's status
  // column does) and gearbox lines without a real ERP code (isErpCode in the host's lib/actuatorStock).
  stock: {
    lines: sql`SELECT 'A:' || a."erpCode" AS id, a."erpCode", 'Actuator' AS kind, a."make", a."ratingCode", a."torque",
        coalesce(v.qty, 0) AS live, a."stockPerErp", a."physicalSum", a."available",
        CASE WHEN coalesce(a."stockPerErp", 0) <> coalesce(a."physicalSum", 0) THEN ${ERP_DIFFERS} ELSE '' END AS "check",
        NULL::text AS remarks, a."stockValue"
      FROM "ActuatorStock" a LEFT JOIN live v ON v.code = a."erpCode"
      UNION ALL
      SELECT 'G:' || g."erpCode", g."erpCode", 'Gearbox', 'GMD', g."gbType", g."ratedTorque",
        coalesce(v.qty, 0), g."stockPerErp", NULL, g."available",
        CASE WHEN btrim(g."erpCode") ~* '^[A-Z]{2,3}[0-9]{6,7}$' THEN '' ELSE ${NEEDS_CODE} END, g."remarks", g."stockValue"
      FROM "GmdGearboxStock" g LEFT JOIN live v ON v.code = g."erpCode"`,
    searched: ["erpCode", "kind", "make", "ratingCode", "check", "remarks"],
    fallback: sql`f."kind", f."make", f."erpCode", f.id`,
    kpi: sql`(count(*) FILTER (WHERE "kind" = 'Actuator'))::int AS "actuators",
      (count(*) FILTER (WHERE "kind" = 'Actuator' AND "make" = 'Rotork'))::int AS "rotork",
      (count(*) FILTER (WHERE "kind" = 'Actuator' AND "make" = 'AUMA'))::int AS "auma",
      coalesce(sum("available") FILTER (WHERE "kind" = 'Actuator'), 0)::float8 AS "units",
      coalesce(sum("stockValue") FILTER (WHERE "kind" = 'Actuator'), 0)::float8 AS "value",
      (count(*) FILTER (WHERE "check" = ${ERP_DIFFERS}))::int AS "erpDiffers",
      (count(*) FILTER (WHERE "kind" = 'Gearbox' AND "check" = ''))::int AS "gbCoded",
      (count(*) FILTER (WHERE "check" = ${NEEDS_CODE}))::int AS "needsCode",
      (count(*) FILTER (WHERE "kind" = 'Actuator' AND "make" = 'AUMA' AND "torque" IS NULL))::int AS "torqueToFill"`,
    live: ["live"],
  },
};

function defOf(view: ViewKey) {
  if (!isViewKey(view)) throw new Error(`Unknown view: ${String(view)}`);
  return { ...VIEWS[view], ...SQL[view] };
}

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(view: ViewKey, query: TableQuery, skip?: string): Prisma.Sql {
  const { columns, searched } = defOf(view);
  const filterable = (key: string) => key !== skip && columns.some((c) => c.key === key && c.filter);
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (values?.length && filterable(key)) parts.push(sql`${cell(key)} IN (${Prisma.join(values.map((v) => (v === BLANK ? "" : v)))})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value.trim() && filterable(key)) parts.push(contains(cell(key), value));
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(Prisma.join(searched.map(cell), " || ' ' || "), search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

export function buildOrderBy(view: ViewKey, sort: TableSort | null): Prisma.Sql {
  const { columns, fallback } = defOf(view);
  const column = sort && columns.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return fallback;
  const c = Prisma.raw(`f."${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(btrim(${c})), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${fallback}`;
  return sql`${c} ${Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC")} NULLS LAST, ${fallback}`;
}

/** The statements behind one page: its rows, and the count + totals of every line the filters keep. */
export function pageSql(view: ViewKey, query: TableQuery, live: Live) {
  const def = defOf(view);
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`${withLive(live)}, l AS (${def.lines}), f AS (SELECT * FROM l WHERE ${buildWhere(view, query)})`;
  const out = Prisma.join([sql`f.id`, ...def.columns.map((c) => Prisma.raw(`f."${c.key}"`))], ", ");
  return {
    rows: sql`${f} SELECT ${out} FROM f ORDER BY ${buildOrderBy(view, query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    kpi: sql`${f} SELECT count(*)::int AS total${def.kpi ? sql`, ${def.kpi}` : Prisma.empty} FROM f`,
  };
}

/** Distinct values of a filter column under every other active filter; numbers in numeric order. Null for any other key. */
export function facetSql(view: ViewKey, key: string, query: TableQuery): Prisma.Sql | null {
  const def = defOf(view);
  const column = def.columns.find((c) => c.key === key && c.filter);
  if (!column) return null;
  const order = column.kind === "number" ? sql`nullif(v, '')::float8 NULLS FIRST` : sql`v`;
  return sql`${withLive(new Map())}, l AS (${def.lines})
    SELECT v FROM (SELECT DISTINCT ${cell(key)} AS v FROM l WHERE ${buildWhere(view, query, key)}) d ORDER BY ${order} LIMIT ${FACET_LIMIT}`;
}

/** The matrix columns with their live stock: an actuator sums its ERP stock lines (none: NULL), a gearbox reads its own code. */
export const codesSql = (live: Live) => sql`${withLive(live)},
  c AS (SELECT DISTINCT ON (code) code, kind, make, label, "ratingNm" FROM "ActuatorSuitability" ORDER BY code, "mapKey")
  SELECT c.code, c.kind, c.make, c.label, c."ratingNm",
    CASE WHEN c.kind = 'GB' THEN coalesce((SELECT v.qty FROM live v WHERE v.code = c.code), 0)
      ELSE (SELECT sum(coalesce(v.qty, 0)) FROM "ActuatorStock" a LEFT JOIN live v ON v.code = a."erpCode" WHERE a."actCode" = c.code) END AS stock
  FROM c ORDER BY c.make, coalesce(c."ratingNm", 0), c.label`;

/** Physical Stock keeps qty as text ("1,250"); anything that is not a number counts 0. */
export const qtyOf = (v: string | null) => {
  const n = parseFloat((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

/** Every ERP code the views read live: actuator and gearbox stock lines, mapping gearboxes, matrix gearboxes. */
const LIVE_CODES = sql`SELECT "erpCode" AS code FROM "ActuatorStock" UNION SELECT "erpCode" FROM "GmdGearboxStock"
  UNION SELECT "gmdGbCode" FROM "ActuatorMapping" WHERE "gmdGbCode" <> ''
  UNION SELECT code FROM "ActuatorSuitability" WHERE kind = 'GB'`;

async function readLive(): Promise<{ live: Live; error: string | null }> {
  const codes = (await prisma.$queryRaw<{ code: string }[]>(LIVE_CODES)).map((r) => r.code);
  try {
    const rows = await stockPrisma.physicalStock.findMany({ where: { erp_code: { in: codes } }, select: { erp_code: true, available_qty: true } });
    // Physical Stock can hold several lines per code: sum them.
    const live = new Map<string, number>();
    for (const r of rows) live.set(r.erp_code!, (live.get(r.erp_code!) ?? 0) + qtyOf(r.available_qty));
    return { live, error: null };
  } catch (err) {
    console.error("[actuator-mapping] live stock read failed", err);
    return { live: new Map(), error: STOCK_ERROR };
  }
}

export async function listPage(view: ViewKey, query: TableQuery): Promise<PageData> {
  const def = defOf(view);
  const { live, error } = await readLive();
  const q = pageSql(view, query, live);
  const [rows, [head], codes] = await Promise.all([
    prisma.$queryRaw<Row[]>(q.rows),
    prisma.$queryRaw<Record<string, number>[]>(q.kpi),
    view === "suitability" ? prisma.$queryRaw<SuitCode[]>(codesSql(live)) : null,
  ]);
  const { total, ...kpi } = head;
  const meta: PageMeta = { stockError: error, kpi };
  if (codes) {
    const marks = await prisma.$queryRaw<{ mapKey: string; code: string; mark: string }[]>`SELECT "mapKey", code, mark
      FROM "ActuatorSuitability" WHERE "mapKey" = ANY(${rows.map((r) => r.id)}::text[]) AND mark <> ''`;
    meta.marks = {};
    for (const m of marks) (meta.marks[m.mapKey] ??= {})[m.code] = m.mark;
    meta.codes = error ? codes.map((c) => ({ ...c, stock: null })) : codes;
  }
  const unknown = error ? Object.fromEntries(def.live.map((k) => [k, null])) : {};
  return { rows: error ? rows.map((r) => ({ ...r, ...unknown })) : rows, total, meta };
}

/** Distinct values of a filter column under every other active filter; empty cells come first as BLANK. */
export async function listFacet(view: ViewKey, key: string, query: TableQuery): Promise<string[]> {
  const q = facetSql(view, key, query);
  if (!q) return [];
  const values = (await prisma.$queryRaw<{ v: string }[]>(q)).map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
