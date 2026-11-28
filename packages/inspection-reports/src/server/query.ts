import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import {
  CHECKS_FAILING,
  CHECKS_PASSED,
  HEADER_KEYS,
  INSPECTION_COLUMNS,
  REPORT_STATUSES,
  TEAM_KEYS,
  type InspectionOfferRow,
  type InspectionPageData,
} from "../columns";

// The Inspection Reports list in SQL: one row per offer, paged, filtered, faceted, searched and sorted on
// the server. The report JSON is read with jsonb functions that mirror the app's lib/inspectionReport.ts
// (checkReport, serialCount, parseReportDate, serialSummary, teamLines, reportMatches); test/query.test.ts
// pins the SQL. Only keys listed in ../columns reach the SQL. No auth here: the host's actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const COLUMN = new Map(INSPECTION_COLUMNS.map((c) => [c.key, c]));
/** Quoted identifier; only ever called with keys from ../columns. */
const ident = (name: string) => Prisma.raw(`"${name}"`);
/** SQL literal of a constant of this package, never of user input. */
const lit = (v: string) => Prisma.raw(`'${v.replace(/'/g, "''")}'`);
/** Trimmed text, '' for NULL; tabs and line breaks go too, as with JS trim(). */
const txt = (e: Prisma.Sql) => sql`btrim(coalesce(${e}, ''), E' \\t\\n\\r\\f\\x0b')`;
/** A JSON array, else [] (jsonb_array_elements throws on anything else). */
const arr = (e: Prisma.Sql) => sql`(CASE WHEN jsonb_typeof(${e}) = 'array' THEN ${e} ELSE '[]'::jsonb END)`;
/** Text of one key of a JSON object. */
const field = (obj: Prisma.Sql, k: string) => sql`(${obj}->>${lit(k)})`;
/** Header field of the report JSON `data`. */
const hdr = (k: string, data = sql`r.data`) => field(sql`${data}->'header'`, k);
/** A check as 0 / 1; unknown (NULL) counts as failed. */
const ok = (cond: Prisma.Sql) => sql`coalesce((${cond}), false)::int`;

/**
 * toNumber(): "1,000" -> 1000, "1e3" -> 1000; NULL when blank, not a decimal (JS also reads 0x10, no qty cell
 * holds one) or past float8 as Infinity is. float8, so the qty checks round as the JS ones do. Read through
 * numeric with caps, so a junk cell cannot overflow and fail the whole page.
 */
const num = (e: Prisma.Sql) => {
  const v = sql`replace(${txt(e)}, ',', '')`;
  return sql`(CASE WHEN length(${v}) <= 1000 AND ${v} ~ '^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]{1,4})?$' THEN
    CASE WHEN abs(${v}::numeric) >= 1e308 THEN NULL WHEN abs(${v}::numeric) < 1e-320 THEN 0 ELSE ${v}::numeric::float8 END END)`;
};

// A serial split as SERIAL = /^(.*?)(\d+)$/ splits it: "ABC-0101" -> prefix 'ABC-', number 101; NULLs without trailing digits.
const digits = (v: Prisma.Sql) => sql`substring(${v} from '[0-9]+$')`;
const serialPrefix = (v: Prisma.Sql) => sql`left(${v}, -length(${digits(v)}))`;
const serialNumber = (v: Prisma.Sql) => sql`(CASE WHEN length(${digits(v)}) <= 300 THEN ${digits(v)}::float8 END)`;

/** serialCount(): "ABC-0101".."ABC-0150" -> 50; NULL unless both end in digits after the same prefix and from <= to. */
const serialCount = (from: Prisma.Sql, to: Prisma.Sql) => {
  const n = sql`(${serialNumber(to)} - ${serialNumber(from)} + 1)`;
  return sql`(CASE WHEN ${serialPrefix(from)} = ${serialPrefix(to)} AND ${n} > 0 THEN ${n} END)`;
};

const MONTHS = Prisma.raw("ARRAY['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']");
/** Date.UTC reads years 0-99 as 1900-1999. */
const year = (y: Prisma.Sql) => sql`(CASE WHEN ${y} <= 99 THEN 1900 + ${y} ELSE ${y} END)`;

/**
 * parseReportDate(): YYYY-M-D, or D-M-YY(YY) / D-Mon-YY(YY) with - / or . between; NULL when unreadable.
 * Built as the 1st plus months and days, so a day past the month end (or an ISO month past 12) rolls over
 * as Date.UTC does instead of failing the whole query.
 */
export const reportDate = (e: Prisma.Sql) => sql`(SELECT CASE
    WHEN d.iso IS NOT NULL THEN (make_date(${year(sql`d.iso[1]::int`)}, 1, 1) + make_interval(months => d.iso[2]::int - 1, days => d.iso[3]::int - 1))::date
    WHEN d.mon BETWEEN 1 AND 12 THEN make_date(CASE WHEN length(d.dmy[3]) = 2 THEN 2000 + d.dmy[3]::int ELSE ${year(sql`d.dmy[3]::int`)} END, d.mon, 1) + (d.dmy[1]::int - 1)
  END FROM (SELECT m.iso, m.dmy, CASE WHEN m.dmy[2] ~ '^[0-9]+$' THEN m.dmy[2]::int ELSE array_position(${MONTHS}, m.dmy[2]) END AS mon
    FROM (SELECT regexp_match(t.v, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$') AS iso,
        regexp_match(t.v, '^([0-9]{1,2})[-/.]([A-Z]{3}|[0-9]{1,2})[-/.]([0-9]{2,4})$') AS dmy
      FROM (SELECT upper(${txt(e)}) AS v) t) m) d)`;

const items = arr(sql`r.data->'items'`);
/** FROM the items of the report JSON `data` (e.it, in order e.n) with their serial range text and count (y). */
const itemRows = (data = sql`r.data`) => sql`jsonb_array_elements(${arr(sql`${data}->'items'`)}) WITH ORDINALITY e(it, n)
  CROSS JOIN LATERAL (SELECT ${txt(field(sql`e.it`, "serialFrom"))} AS sf, ${txt(field(sql`e.it`, "serialTo"))} AS st) x
  CROSS JOIN LATERAL (SELECT ${serialCount(sql`x.sf`, sql`x.st`)} AS cnt, concat_ws(' – ', nullif(x.sf, ''), nullif(x.st, '')) AS rng) y`;
/** FROM the team of the report JSON `data` (m.v, in order m.n): the member as teamLines() writes it, and whether every part is filled (z). */
const teamRows = (data = sql`r.data`) => sql`jsonb_array_elements(${arr(sql`${data}->'team'`)}) WITH ORDINALITY m(v, n)
  CROSS JOIN LATERAL (SELECT concat_ws(', ', ${Prisma.join(TEAM_KEYS.map((k) => sql`nullif(${txt(field(sql`m.v`, k))}, '')`), ", ")}) AS line,
    ${Prisma.join(TEAM_KEYS.map((k) => sql`${txt(field(sql`m.v`, k))} <> ''`), " AND ")} AS complete) z`;

// The report cells are scalar subqueries, not joins, so Postgres works them out only where they are read:
// for the rows on the page, or for every offer when a filter, facet or sort needs them.

/** serialSummary().label: "150 serials: S-0001 – S-0100 …"; '' when no serial is filled. */
const SERIALS = sql`(SELECT CASE WHEN s.filled = 0 THEN '' WHEN s.uncountable THEN s.head
    ELSE s.total::text || CASE WHEN s.total = 1 THEN ' serial: ' ELSE ' serials: ' END || s.head END
  FROM (SELECT count(*) FILTER (WHERE y.rng <> '') AS filled, sum(y.cnt) FILTER (WHERE y.rng <> '') AS total,
      coalesce(bool_or(y.cnt IS NULL) FILTER (WHERE y.rng <> ''), false) AS uncountable,
      (array_agg(y.rng ORDER BY e.n) FILTER (WHERE y.rng <> ''))[1] || CASE WHEN count(*) FILTER (WHERE y.rng <> '') > 1 THEN ' …' ELSE '' END AS head
    FROM ${itemRows()}) s)`;
/** serialSummary().ranges: "item: from – to" per item with a serial. */
const RANGES = sql`(SELECT coalesce(array_agg(coalesce(${field(sql`e.it`, "itemCode")}, '') || ': ' || y.rng ORDER BY e.n) FILTER (WHERE y.rng <> ''), '{}')
  FROM ${itemRows()})`;
/** teamLines(). */
const MEMBERS = sql`(SELECT coalesce(array_agg(z.line ORDER BY m.n) FILTER (WHERE z.line <> ''), '{}') FROM ${teamRows()})`;
/**
 * checkReport() checks passed: header filled, team filled, three per item, offer date <= inspection date = JIR date.
 * Reads the JSON once (rd, kept apart by OFFSET 0): every ->> on r.data would unpack a large stored report again.
 * shortcut: worked out from the JSON on every query, so filtering or sorting by Checks reads every report (about 1.4 s
 * for 3,000 eight-line reports on PGlite); store passed / total with the report if offers reach the tens of thousands.
 */
const PASSED = sql`(SELECT (${ok(Prisma.join(HEADER_KEYS.map((k) => sql`${txt(hdr(k, sql`rd.d`))} <> ''`), " AND "))} + ${ok(sql`tm.ok`)} + i.passed
    + ${ok(sql`d.offered <= d.inspected`)} + ${ok(sql`d.inspected = d.jir`)})::int
  FROM (SELECT r.data || '{}'::jsonb AS d OFFSET 0) rd
  CROSS JOIN LATERAL (SELECT coalesce(sum(${ok(sql`q.offered IS NOT NULL AND q.rq = q.offered`)} + ${ok(sql`q.cq - coalesce(q.ai, 0) - q.offered >= 0`)} + ${ok(sql`y.cnt = q.rq`)}), 0) AS passed
    FROM ${itemRows(sql`rd.d`)}
    CROSS JOIN LATERAL (SELECT ${num(field(sql`e.it`, "qtyOffered"))} AS offered, ${num(field(sql`e.it`, "reportQty"))} AS rq,
      ${num(field(sql`e.it`, "contractQty"))} AS cq, ${num(field(sql`e.it`, "alreadyInspected"))} AS ai) q) i
  CROSS JOIN LATERAL (SELECT count(*) > 0 AND coalesce(bool_and(z.complete), false) AS ok FROM ${teamRows(sql`rd.d`)}) tm
  CROSS JOIN LATERAL (SELECT ${reportDate(hdr("offerDate", sql`rd.d`))} AS offered, ${reportDate(hdr("inspectionDate", sql`rd.d`))} AS inspected,
    ${reportDate(hdr("jirDate", sql`rd.d`))} AS jir) d)`;
/** checkReport() length: header and team, three per item (one failing when there are none), two date checks. */
const TOTAL = sql`(4 + greatest(3 * jsonb_array_length(${items}), 1))`;

/** CTE `l`: one row per offer, columns named by the column keys, plus what the search and the sorts read. */
const OFFERS = sql`SELECT b.*,
    CASE WHEN b."reportId" IS NULL THEN '' WHEN b."checksPassed" = b."checksTotal" THEN ${lit(CHECKS_PASSED)} ELSE ${lit(CHECKS_FAILING)} END AS checks
  FROM (SELECT o.id, r.id AS "reportId", o.vrno, o."createdAt",
      ${reportDate(sql`o."vrDate"`)} AS "vrDate", ${txt(sql`o."vrDate"`)} AS "vrDateText",
      ${txt(sql`o."contractVrno"`)} AS "contractVrno", ${txt(hdr("contractNo"))} AS "contractNo", ${txt(sql`o."accCode"`)} AS "accCode",
      jsonb_array_length(${arr(sql`o.lines`)}) AS lines,
      ${SERIALS} AS serials, ${RANGES} AS "serialRanges", array_to_string(${MEMBERS}, '; ') AS team, ${MEMBERS} AS "teamMembers",
      coalesce(r.status, '') AS status, array_position(ARRAY[${Prisma.join(REPORT_STATUSES.map(lit))}], r.status) AS "statusRank",
      CASE WHEN r.id IS NOT NULL THEN ${PASSED} END AS "checksPassed", CASE WHEN r.id IS NOT NULL THEN ${TOTAL} END AS "checksTotal",
      ${items} AS items
    FROM "InspectionOffer" o
    LEFT JOIN "InspectionReport" r ON r."offerId" = o.id) b`;

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
/** Case- and space-insensitive "contains". */
const contains = (e: Prisma.Sql, value: string) => sql`regexp_replace(${e}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** The search read as a serial, as reportMatches() reads it: prefix + number. Long text is skipped: the regex backtracks on long digit runs. */
export function serialNeedle(search: string): { prefix: string; n: number } | null {
  const needle = search.trim().toUpperCase();
  const m = needle.length <= 40 ? /^(.*?)(\d+)$/.exec(needle) : null;
  return m && { prefix: m[1], n: Number(m[2]) };
}

/** reportMatches() plus offer and MC no.: one of them contains the search, or the search is a serial inside an item's range. */
function searchWhere(search: string): Prisma.Sql | null {
  const q = search.trim();
  if (!q) return null;
  const serial = serialNeedle(q);
  const from = txt(field(sql`e.it`, "serialFrom"));
  const to = txt(field(sql`e.it`, "serialTo"));
  // serialInRange(): the same prefix (any case) at both ends and the number between them.
  const [a, b] = [sql`upper(${from})`, sql`upper(${to})`];
  const inRange = serial
    ? sql` OR (${serialPrefix(a)} = ${serial.prefix} AND ${serialPrefix(b)} = ${serial.prefix}
      AND ${serialNumber(a)} <= ${serial.n}::float8 AND ${serial.n}::float8 <= ${serialNumber(b)})`
    : sql``;
  return sql`(${contains(sql`l.vrno`, q)} OR ${contains(sql`l."contractVrno"`, q)} OR ${contains(sql`l."contractNo"`, q)} OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(l.items) e(it) WHERE ${contains(from, q)} OR ${contains(to, q)}${inRange}))`;
}

/** Filter / "contains" text of a key: the cell text, numbers as text. */
const text = (key: string) => sql`coalesce(l.${ident(key)}::text, '')`;
/** One facet value of a key; the team matches any member. */
const match = (key: string, v: string) =>
  key === "team"
    ? v === BLANK
      ? sql`cardinality(l."teamMembers") = 0`
      : sql`${v} = ANY(l."teamMembers")`
    : v === BLANK
      ? sql`${text(key)} = ''`
      : sql`${text(key)} = ${v}`;

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(query: TableQuery, skip?: string): Prisma.Sql {
  const filterable = (key: string, date: boolean) => {
    const c = COLUMN.get(key);
    return key !== skip && !!c?.filter && (c.kind === "date") === date;
  };
  const parts: Prisma.Sql[] = [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (values?.length && filterable(key, false)) parts.push(sql`(${Prisma.join(values.map((v) => match(key, v)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value?.trim() && filterable(key, false)) parts.push(contains(text(key), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (!filterable(key, true)) continue;
    if (range?.from) parts.push(sql`l.${ident(key)} >= ${range.from}::date`);
    if (range?.to) parts.push(sql`l.${ident(key)} <= ${range.to}::date`);
  }
  const search = searchWhere(query.search ?? "");
  if (search) parts.push(search);
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

/** Sort key that orders digit runs by value ("OD-9" before "OD-10"), as the old page's numeric localeCompare did; NULL when blank. */
const natural = (e: Prisma.Sql) =>
  sql`(SELECT string_agg(CASE WHEN g.m[1] ~ '^[0-9]' THEN lpad(g.m[1], 20, '0') ELSE lower(g.m[1]) END, '' ORDER BY g.n)
    FROM regexp_matches(${e}, '[0-9]+|[^0-9]+', 'g') WITH ORDINALITY g(m, n))`;
/** Where the order is not the cell's: statuses in workflow order, checks by the share passed. */
const SORT: Record<string, Prisma.Sql> = {
  status: sql`f."statusRank"`,
  checks: sql`f."checksPassed"::float8 / nullif(f."checksTotal", 0)`,
};
const FALLBACK = sql`f."createdAt" DESC, f.id`;

/** Blanks last both ways, as before; ties keep the newest offer first. */
export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && COLUMN.get(sort.key);
  if (!sort || !column?.sortable) return FALLBACK;
  const c = sql`f.${ident(column.key)}`;
  const by = SORT[column.key] ?? (column.kind === "text" ? natural(c) : c);
  return sql`${by} ${Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC")} NULLS LAST, ${FALLBACK}`;
}

const OUT = sql`f.id, f."reportId", f.vrno, coalesce(to_char(f."vrDate", 'YYYY-MM-DD'), f."vrDateText") AS "vrDate",
  f."contractVrno", f."contractNo", f."accCode", f.lines, f.serials, f."serialRanges", f.team, f."teamMembers",
  f.status, f.checks, f."checksPassed", f."checksTotal"`;

/** The statements behind one page: its rows, and the count of every offer the filters keep. */
export function pageSql(query: TableQuery) {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`WITH l AS (${OFFERS}), f AS (SELECT * FROM l WHERE ${buildWhere(query)})`;
  return {
    rows: sql`${f} SELECT ${OUT} FROM f ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    total: sql`${f} SELECT count(*)::int AS total FROM f`,
  };
}

export async function listInspectionPage(query: TableQuery): Promise<InspectionPageData> {
  const q = pageSql(query);
  const [rows, [head]] = await Promise.all([
    prisma.$queryRaw<InspectionOfferRow[]>(q.rows),
    prisma.$queryRaw<{ total: number }[]>(q.total),
  ]);
  return { rows, total: head.total };
}

/** Distinct values of a filterable key under every other active filter (team: one per member); null for keys without a facet. */
export function facetSql(key: string, query: TableQuery): Prisma.Sql | null {
  const c = COLUMN.get(key);
  if (!c?.filter || c.kind === "date") return null;
  const value = key === "team" ? sql`unnest(CASE WHEN cardinality(l."teamMembers") = 0 THEN ARRAY[''] ELSE l."teamMembers" END)` : text(key);
  return sql`WITH l AS (${OFFERS}) SELECT DISTINCT ${value} AS v FROM l WHERE ${buildWhere(query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
}

const statusRank = (v: string) => REPORT_STATUSES.indexOf(v as (typeof REPORT_STATUSES)[number]);

/** Empty cells come first as BLANK; line counts in number order, statuses in workflow order. */
export async function listInspectionFacet(key: string, query: TableQuery): Promise<string[]> {
  const q = facetSql(key, query);
  if (!q) return [];
  const values = (await prisma.$queryRaw<{ v: string }[]>(q)).map((r) => r.v);
  if (key === "lines") values.sort((a, b) => Number(a) - Number(b));
  if (key === "status") values.sort((a, b) => statusRank(a) - statusRank(b));
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}
