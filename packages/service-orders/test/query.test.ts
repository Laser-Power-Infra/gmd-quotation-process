import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { COLUMNS, KPIS } from "../src/columns";
import { buildOrderBy, buildWhere, facetSql, linesSql, listServiceOrderFacet, listServiceOrderPage, pageSql } from "../src/server/query";
import reducer, { clearFilters, queryOf, setFilter, setOverdueOnly, setPage, setShowClosed } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

test("buildWhere: open lines only by default; the two toggles", () => {
  assert.equal(buildWhere(base).sql, "l.open");
  assert.equal(buildWhere({ ...base, extra: { showClosed: true } }).sql, "TRUE");
  assert.equal(buildWhere({ ...base, extra: { showClosed: true, overdueOnly: true } }).sql, "l.overdue");
  assert.equal(flat(buildWhere({ ...base, extra: { overdueOnly: true } })), "l.open AND l.overdue");
});

test("buildWhere: text and number facets, blank, search; unknown keys ignored", () => {
  const all = { showClosed: true };
  const w = buildWhere({ ...base, extra: all, filters: { supplier: ["ACME", BLANK], grnCount: ["0"], bogus: ["x"], orderDate: ["2026-01-01"] }, search: "pe 26y" });
  assert.match(flat(w), /\(l\."supplier" = \? OR l\."supplier" = ''\)/);
  // Numbers match the text their dropdown lists: rounded to 2 places, '' when blank.
  assert.match(flat(w), /\(coalesce\(trim_scale\(round\(l\."grnCount"::numeric, 2\)\)::text, ''\) = \?\)/);
  assert.match(flat(w), /l\."orderNo" \|\| ' ' \|\| l\."supplier" \|\| ' ' \|\| l\."supplierCode" .* ILIKE \?/);
  assert.deepEqual(w.values, ["ACME", "0", "%pe26y%"]);
  assert.ok(!w.sql.includes("bogus") && !w.sql.includes('l."orderDate"')); // a date column has no value list
  // A key's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere({ ...base, extra: all, filters: { um: ["NOS"] } }, "um").sql, "TRUE");
});

test("buildWhere: date ranges on date columns only; column search squashes spaces", () => {
  const w = buildWhere({
    ...base,
    extra: { showClosed: true },
    dateRanges: { dueDate: { from: "2026-01-01", to: "2026-01-31" }, supplier: { from: "2026-01-01", to: "" } },
    columnSearch: { serviceName: "mach ining", nope: "x", lastGrnDate: "2026" },
  });
  assert.match(flat(w), /regexp_replace\(l\."serviceName", '\[\[:space:\]\]', '', 'g'\) ILIKE \?/);
  assert.match(flat(w), /l\."dueDate" >= \?::date AND l\."dueDate" <= \?::date/);
  assert.deepEqual(w.values, ["%machining%", "2026-01-01", "2026-01-31"]);
  assert.ok(!w.sql.includes("nope") && !w.sql.includes('l."supplier"') && !w.sql.includes('l."lastGrnDate"'));
});

test("buildOrderBy: by kind, then open lines and days pending; unknown keys fall back", () => {
  const fallback = buildOrderBy(null).sql;
  assert.match(flat(buildOrderBy(null)), /^f\.open DESC, f\."daysPending" DESC NULLS LAST, f\."orderNo", \(CASE WHEN f\."lineNo"/);
  assert.match(flat(buildOrderBy({ key: "pendingValue", dir: "desc" })), /^f\."pendingValue" DESC NULLS LAST, f\.open DESC/);
  assert.match(flat(buildOrderBy({ key: "dueDate", dir: "asc" })), /^f\."dueDate" ASC NULLS LAST, /);
  assert.match(flat(buildOrderBy({ key: "supplier", dir: "desc" })), /^NULLIF\(lower\(f\."supplier"\), ''\) DESC NULLS FIRST, /);
  assert.ok(buildOrderBy({ key: "supplier", dir: "asc" }).sql.endsWith(fallback));
  assert.equal(buildOrderBy({ key: "overdue", dir: "asc" }).sql, fallback); // a field, not a column
  assert.equal(buildOrderBy({ key: 'x"; drop', dir: "asc" }).sql, fallback);
});

test("linesSql: service codes are one array parameter; receipts join on order no + line", () => {
  const l = linesSql(["SRV001", "SRV002"]);
  assert.deepEqual(l.values, [["SRV001", "SRV002"]]);
  assert.match(flat(l), /WHERE upper\(btrim\(coalesce\(p\."itemCode", ''\)\)\) = ANY\(\?::text\[\]\)/);
  assert.match(flat(l), /LEFT JOIN r ON r\.vr = upper\(s\."orderNo"\) AND r\.sl = s\."lineNo"/);
  // Pending is the sync's in-transit qty; the value needs a rate, a blank exchange rate counts as 1.
  assert.match(flat(l), /coalesce\(p\."inTransit", 0\)::numeric AS pending/);
  assert.match(flat(l), /s\.pending \* s\.rate \* coalesce\(nullif\(s\.fx, 0\), 1\) AS "pendingValue"/);
  assert.match(flat(l), /CASE WHEN s\.pending > 0 THEN current_date - s\."orderDate" END AS "daysPending"/);
});

test("pageSql: page size is capped, dates leave as ISO text, numbers as floats, tiles in SQL", () => {
  const q = pageSql({ ...base, page: 2, pageSize: 1000 }, ["SRV001"]);
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 200]);
  assert.match(flat(q.rows), /to_char\(f\."orderDate", 'YYYY-MM-DD'\) AS "orderDate"/);
  assert.match(flat(q.rows), /f\."pendingValue"::float8 AS "pendingValue"/);
  assert.match(flat(q.kpi), /count\(\*\)::int AS total, \(SELECT count\(\*\) FROM l\)::int AS "allLines"/);
  for (const t of KPIS) assert.ok(q.kpi.sql.includes(`AS "${t.key}"`), t.key);
  assert.deepEqual(pageSql({ ...base, page: 0, pageSize: 0 }, []).rows.values.slice(-2), [1, 0]);
});

test("facetSql: text and number columns only; numbers list smallest first", () => {
  assert.equal(facetSql("orderDate", base, []), null);
  assert.equal(facetSql("bogus", base, []), null);
  const n = facetSql("daysPending", { ...base, filters: { daysPending: ["3"] } }, ["SRV001"])!;
  assert.match(flat(n), /GROUP BY 1 ORDER BY min\(l\."daysPending"\) NULLS FIRST, 1 LIMIT \?$/);
  assert.match(flat(n), /WHERE l\.open GROUP BY/); // its own filter is skipped
  assert.match(flat(facetSql("supplier", base, [])!), /SELECT l\."supplier" AS v FROM l WHERE l\.open GROUP BY 1 ORDER BY 1 LIMIT \?$/);
});

test("every column filters and sorts; KPI tiles are unique", () => {
  assert.ok(COLUMNS.every((c) => c.filter && c.sortable && ["text", "number", "date"].includes(c.kind)));
  assert.equal(new Set(COLUMNS.map((c) => c.key)).size, COLUMNS.length);
  assert.equal(new Set(KPIS.map((t) => t.key)).size, KPIS.length);
});

test("slice: filters and toggles reset the page; clear keeps 'show fully received'", () => {
  let s = reducer(undefined, { type: "init" });
  assert.deepEqual(queryOf(s).extra, { showClosed: false, overdueOnly: false });
  s = reducer(s, setPage(3));
  s = reducer(s, setFilter({ key: "supplier", values: ["ACME"] }));
  assert.equal(s.page, 1);
  s = reducer(s, setShowClosed(true));
  s = reducer(s, setOverdueOnly(true));
  assert.deepEqual(queryOf(s).extra, { showClosed: true, overdueOnly: true });
  s = reducer(s, clearFilters());
  assert.deepEqual(s.filters, {});
  assert.deepEqual(queryOf(s).extra, { showClosed: true, overdueOnly: false });
  s = reducer(s, setFilter({ key: "supplier", values: [] }));
  assert.deepEqual(s.filters, {});
});

// Live DB smoke: SERVICE_ORDERS_SMOKE=1 QUOTATION_DATABASE_URL=... STOCK_DATABASE_URL=... pnpm test
test("page and facet queries run against the quotation + stock DBs", { skip: !process.env.SERVICE_ORDERS_SMOKE }, async () => {
  const page = await listServiceOrderPage({ ...base, pageSize: 5, extra: { showClosed: true } });
  console.log(JSON.stringify({ total: page.total, meta: page.meta, first: page.rows[0] }));
  assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
  for (const key of ["supplier", "daysPending"]) assert.ok(Array.isArray(await listServiceOrderFacet(key, base)));
});
