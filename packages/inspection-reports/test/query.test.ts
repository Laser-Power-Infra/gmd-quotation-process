import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { HEADER_KEYS, INSPECTION_COLUMNS, TEAM_KEYS } from "../src/columns";
import { buildOrderBy, buildWhere, facetSql, listInspectionFacet, listInspectionPage, pageSql, reportDate, serialNeedle } from "../src/server/query";
import reducer, { clearFilters, queryOf, setFilter, setPage, setSearch, setSort } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

test("serialNeedle reads the search as reportMatches() does: prefix + number, any case, nothing for long text", () => {
  assert.deepEqual(serialNeedle(" gmd-0125 "), { prefix: "GMD-", n: 125 });
  assert.deepEqual(serialNeedle("GMD-125"), { prefix: "GMD-", n: 125 });
  assert.deepEqual(serialNeedle("12345"), { prefix: "", n: 12345 });
  assert.equal(serialNeedle("SD26Y"), null);
  const t0 = performance.now();
  assert.equal(serialNeedle("1".repeat(16000) + "A"), null);
  assert.ok(performance.now() - t0 < 100);
});

test("search: offer / MC / contract no. and serial ends contain it, or it is a serial inside an item's range", () => {
  const w = buildWhere({ ...base, search: " GMD-0125 " });
  const s = flat(w);
  for (const col of ['l.vrno', 'l."contractVrno"', 'l."contractNo"']) assert.ok(s.includes(`regexp_replace(${col}, '[[:space:]]', '', 'g') ILIKE ?`), col);
  assert.match(s, /EXISTS \( SELECT 1 FROM jsonb_array_elements\(l\.items\) e\(it\) WHERE /);
  assert.match(s, /'serialFrom'.* ILIKE \? OR .*'serialTo'.* ILIKE \?/);
  // In range: the same prefix at both ends (any case) and the number between them.
  assert.match(s, /left\(upper\(btrim\(coalesce\(\(e\.it->>'serialFrom'\)/);
  assert.match(s, /<= \?::float8 AND \?::float8 <= /);
  assert.deepEqual(w.values, ["%GMD-0125%", "%GMD-0125%", "%GMD-0125%", "%GMD-0125%", "%GMD-0125%", "GMD-", "GMD-", 125, 125]);
  // Text without trailing digits is no serial; LIKE wildcards are matched literally and spaces ignored.
  const t = buildWhere({ ...base, search: "sd 26y_%" });
  assert.ok(!flat(t).includes("::float8"));
  assert.deepEqual(t.values, Array(5).fill("%sd26y\\_\\%%"));
});

test("filters: facet values, blank, team members, contains, date range; unknown or unfiltered keys are ignored", () => {
  const w = buildWhere({
    ...base,
    filters: { status: ["draft", BLANK], team: ["RITES, A. Kumar, IE", BLANK], lines: ["2"], serials: ["x"], vrDate: ["2026"], bogus: ["x"] },
    columnSearch: { team: "ram esh", nope: "x" },
    dateRanges: { vrDate: { from: "2026-10-01", to: "2026-10-31" }, status: { from: "2026-01-01", to: "" } },
  });
  const s = flat(w);
  assert.match(s, /\(coalesce\(l\."status"::text, ''\) = \? OR coalesce\(l\."status"::text, ''\) = ''\)/);
  assert.match(s, /\(\? = ANY\(l\."teamMembers"\) OR cardinality\(l\."teamMembers"\) = 0\)/);
  assert.match(s, /coalesce\(l\."lines"::text, ''\) = \?/);
  assert.match(s, /regexp_replace\(coalesce\(l\."team"::text, ''\), '\[\[:space:\]\]', '', 'g'\) ILIKE \?/);
  assert.match(s, /l\."vrDate" >= \?::date AND l\."vrDate" <= \?::date/);
  assert.deepEqual(w.values, ["draft", "RITES, A. Kumar, IE", "2", "%ramesh%", "2026-10-01", "2026-10-31"]);
  for (const k of ["serials", "bogus", "nope", "2026-01-01"]) assert.ok(!s.includes(k) && !w.values.includes(k), k);
  assert.equal(buildWhere(base).sql, "TRUE");
  // A key's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere({ ...base, filters: { checks: ["Failing"] } }, "checks").sql, "TRUE");
});

test("sort: dates and numbers by value, statuses in workflow order, checks by share passed, text by number-aware key", () => {
  const fallback = 'f."createdAt" DESC, f.id';
  assert.equal(flat(buildOrderBy(null)), fallback);
  assert.equal(flat(buildOrderBy({ key: "vrDate", dir: "asc" })), `f."vrDate" ASC NULLS LAST, ${fallback}`);
  assert.equal(flat(buildOrderBy({ key: "lines", dir: "desc" })), `f."lines" DESC NULLS LAST, ${fallback}`);
  assert.equal(flat(buildOrderBy({ key: "status", dir: "asc" })), `f."statusRank" ASC NULLS LAST, ${fallback}`);
  assert.equal(flat(buildOrderBy({ key: "checks", dir: "desc" })), `f."checksPassed"::float8 / nullif(f."checksTotal", 0) DESC NULLS LAST, ${fallback}`);
  const vrno = flat(buildOrderBy({ key: "vrno", dir: "desc" }));
  assert.match(vrno, /lpad\(g\.m\[1\], 20, '0'\).*regexp_matches\(f\."vrno", '\[0-9\]\+\|\[\^0-9\]\+', 'g'\).* DESC NULLS LAST, /);
  assert.equal(flat(buildOrderBy({ key: "serials", dir: "asc" })), fallback); // not sortable
  assert.equal(flat(buildOrderBy({ key: 'x"; drop table', dir: "asc" })), fallback);
});

test("page: size capped, offset, dates out as ISO (else as synced), count over the same filters", () => {
  const q = pageSql({ ...base, page: 3, pageSize: 1000 });
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 400]);
  assert.match(flat(q.rows), /coalesce\(to_char\(f\."vrDate", 'YYYY-MM-DD'\), f\."vrDateText"\) AS "vrDate"/);
  assert.match(flat(q.total), /SELECT count\(\*\)::int AS total FROM f$/);
  assert.deepEqual(pageSql({ ...base, page: NaN, pageSize: 0 }).rows.values.slice(-2), [1, 0]);
});

test("checks mirror checkReport(): every header and team field, three per item, the dates, read once per report", () => {
  const s = flat(pageSql(base).rows);
  for (const k of HEADER_KEYS) assert.ok(s.includes(`(rd.d->'header'->>'${k}')`), k);
  for (const k of TEAM_KEYS) assert.ok(s.includes(`(m.v->>'${k}')`), k);
  assert.ok(s.includes("FROM (SELECT r.data || '{}'::jsonb AS d OFFSET 0) rd"));
  assert.ok(s.includes("q.offered IS NOT NULL AND q.rq = q.offered") && s.includes("q.cq - coalesce(q.ai, 0) - q.offered >= 0"));
  assert.ok(s.includes(`WHEN b."checksPassed" = b."checksTotal" THEN`));
  assert.ok(s.includes("d.offered <= d.inspected") && s.includes("d.inspected = d.jir"));
  assert.ok(s.includes("(4 + greatest(3 * jsonb_array_length("));
  assert.ok(s.includes(`'All passed'`) && s.includes(`'Failing'`));
});

test("dates: the formats parseReportDate() reads, rolled over as Date.UTC does, never an error", () => {
  const s = flat(reportDate(Prisma.sql`o."vrDate"`));
  assert.ok(s.includes(`regexp_match(t.v, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$')`));
  assert.ok(s.includes(`regexp_match(t.v, '^([0-9]{1,2})[-/.]([A-Z]{3}|[0-9]{1,2})[-/.]([0-9]{2,4})$')`));
  assert.ok(s.includes("make_interval(months => d.iso[2]::int - 1, days => d.iso[3]::int - 1)"));
  assert.ok(s.includes("WHEN d.mon BETWEEN 1 AND 12") && s.includes("2000 + d.dmy[3]::int"));
  assert.ok(s.includes("upper(btrim(coalesce(o.\"vrDate\", ''), E' \\t\\n\\r\\f\\x0b'))"));
});

test("facets: team one per member, own filter skipped, no facet for dates or unfiltered keys", () => {
  const team = flat(facetSql("team", { ...base, filters: { team: ["X"], status: ["draft"] } })!);
  assert.match(team, /SELECT DISTINCT unnest\(CASE WHEN cardinality\(l\."teamMembers"\) = 0 THEN ARRAY\[''\] ELSE l\."teamMembers" END\) AS v FROM l WHERE /);
  assert.ok(team.includes('l."status"') && !team.includes("ANY("));
  assert.match(flat(facetSql("accCode", base)!), /SELECT DISTINCT coalesce\(l\."accCode"::text, ''\) AS v FROM l WHERE TRUE ORDER BY 1 LIMIT \?$/);
  for (const k of ["vrDate", "serials", "bogus"]) assert.equal(facetSql(k, base), null, k);
  assert.ok(INSPECTION_COLUMNS.every((c) => !c.filter || c.kind !== "boolean"));
});

test("slice: filters, search and sort reset the page; clear keeps the sort", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setPage(4));
  s = reducer(s, setFilter({ key: "status", values: ["draft"] }));
  assert.equal(s.page, 1);
  s = reducer(s, setSort({ key: "checks", dir: "asc" }));
  s = reducer(s, setSearch("GMD-0125"));
  assert.deepEqual(queryOf(s), { ...base, sort: { key: "checks", dir: "asc" }, search: "GMD-0125", filters: { status: ["draft"] }, dateRanges: {}, columnSearch: {} });
  s = reducer(s, clearFilters());
  assert.deepEqual([s.filters, s.search, s.sort], [{}, "", { key: "checks", dir: "asc" }]);
});

// Live DB smoke: INSPECTION_REPORTS_SMOKE=1 QUOTATION_DATABASE_URL=... pnpm test (read-only).
test("the date parse, serial search and page / facet queries run on the quotation DB", { skip: !process.env.INSPECTION_REPORTS_SMOKE }, async () => {
  const day = async (v: string) => (await prisma.$queryRaw<{ d: Date | null }[]>`SELECT ${reportDate(Prisma.sql`${v}::text`)} AS d`)[0].d?.toISOString().slice(0, 10) ?? null;
  for (const [v, want] of [["29-10-2026", "2026-10-29"], ["29-Oct-26", "2026-10-29"], ["2026-10-29", "2026-10-29"], ["31-02-2026", "2026-03-03"], ["junk", null], ["29-13-2026", null]])
    assert.equal(await day(v as string), want, v as string);
  const items = JSON.stringify([{ serialFrom: "GMD-0101", serialTo: "GMD-0150" }]);
  const hits = async (search: string) =>
    (await prisma.$queryRaw<{ n: number }[]>`WITH l AS (SELECT 'ID-1' AS vrno, '' AS "contractVrno", 'SD26Y-1' AS "contractNo", ${items}::jsonb AS items)
      SELECT count(*)::int AS n FROM l WHERE ${buildWhere({ ...base, search })}`)[0].n;
  for (const q of ["sd26y", "GMD-0101", "gmd-0125", "GMD-125", "GMD-01"]) assert.equal(await hits(q), 1, q);
  for (const q of ["GMD-0151", "GMD-0100", "XYZ-0125", "PO1"]) assert.equal(await hits(q), 0, q);
  const page = await listInspectionPage({ ...base, pageSize: 5, sort: { key: "checks", dir: "asc" } });
  console.log(JSON.stringify({ total: page.total, first: page.rows[0] }));
  assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
  for (const key of ["status", "team", "checks", "lines"]) assert.ok(Array.isArray(await listInspectionFacet(key, base)), key);
});
