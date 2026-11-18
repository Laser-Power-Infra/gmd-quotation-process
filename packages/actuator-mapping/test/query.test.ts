import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { ERP_DIFFERS, NEEDS_CODE, VIEWS, VIEW_KEYS } from "../src/columns";
import { buildOrderBy, buildWhere, codesSql, facetSql, listFacet, listPage, pageSql, qtyOf } from "../src/server/query";
import reducer, { clearFilters, queryOf, setFilter, setMake, setPage, setView } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");
const cell = (key: string) => `btrim(coalesce(l."${key}"::text, ''))`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("buildWhere: text and number facets match the cell text, blank is ''; unknown, live and other-view keys are ignored", () => {
  const w = buildWhere("mapping", {
    ...base,
    filters: { valveType: ["BUTTERFLY VALVE", BLANK], dn: ["200"], rotorkAvailable: ["3"], kind: ["Gearbox"], bogus: ["x"] },
    search: "pn 16",
  });
  assert.match(flat(w), new RegExp(`${esc(cell("valveType"))} IN \\(\\?,\\?\\)`));
  assert.match(flat(w), new RegExp(`${esc(cell("dn"))} IN \\(\\?\\)`));
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["BUTTERFLY VALVE", "", "200", "%pn16%"]);
  assert.ok(!/rotorkAvailable|kind|bogus/.test(w.sql));
  assert.equal(buildWhere("stock", base).sql, "TRUE");
  // A column's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere("mapping", { ...base, filters: { dn: ["200"] } }, "dn").sql, "TRUE");
  // The matrix filters on its own columns only.
  assert.equal(buildWhere("suitability", { ...base, filters: { gearbox: ["x"] } }).sql, "TRUE");
});

test("buildWhere: column 'contains' text squashes spaces, on filterable columns only", () => {
  const w = buildWhere("stock", { ...base, columnSearch: { remarks: "no code", live: "1" } });
  assert.match(flat(w), new RegExp(`regexp_replace\\(${esc(cell("remarks"))}, '\\[\\[:space:\\]\\]', '', 'g'\\) ILIKE \\?`));
  assert.deepEqual(w.values, ["%nocode%"]);
  assert.ok(!w.sql.includes('"live"'));
});

test("buildOrderBy: numbers NULLS LAST, text lower-cased, live qty sortable; anything else falls back", () => {
  const fallback = buildOrderBy("stock", null).sql;
  assert.match(flat(buildOrderBy("stock", { key: "live", dir: "desc" })), /^f\."live" DESC NULLS LAST, /);
  assert.match(flat(buildOrderBy("mapping", { key: "pn", dir: "asc" })), /^NULLIF\(lower\(btrim\(f\."pn"\)\), ''\) ASC NULLS LAST, /);
  assert.ok(buildOrderBy("stock", { key: "make", dir: "desc" }).sql.endsWith(fallback));
  assert.equal(buildOrderBy("stock", { key: 'x"; drop', dir: "asc" }).sql, fallback);
  assert.equal(buildOrderBy("suitability", { key: "gearbox", dir: "asc" }).sql, buildOrderBy("suitability", null).sql);
  assert.match(flat(buildOrderBy("mapping", null)), /^f\."valveType", f\."dn", f\."pn"/);
  assert.match(flat(buildOrderBy("stock", null)), /^f\."kind", f\."make", f\."erpCode"/);
});

test("pageSql: live stock goes in as two arrays, page size is capped, only listed columns leave", () => {
  const q = pageSql("stock", { ...base, page: 3, pageSize: 1000 }, new Map([["RCB040002", 2], ["RL2010003", 5]]));
  assert.match(flat(q.rows), /^WITH live\(code, qty\) AS \(SELECT \* FROM unnest\(\?::text\[\], \?::float8\[\]\)\)/);
  assert.deepEqual(q.rows.values.slice(0, 2), [["RCB040002", "RL2010003"], [2, 5]]);
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 400]);
  assert.ok(!q.rows.sql.includes('f."stockValue"'));
  // The workbook checks of the old mismatch report, as rows the Check column filters on.
  assert.match(flat(q.rows), /coalesce\(a\."stockPerErp", 0\) <> coalesce\(a\."physicalSum", 0\) THEN \?/);
  assert.match(flat(q.rows), /btrim\(g\."erpCode"\) ~\* '\^\[A-Z\]\{2,3\}\[0-9\]\{6,7\}\$' THEN '' ELSE \?/);
  assert.ok(q.rows.values.includes(ERP_DIFFERS) && q.rows.values.includes(NEEDS_CODE));
  for (const k of VIEWS.stock.kpis) assert.ok(q.kpi.sql.includes(`AS "${k.key}"`), k.key);
  assert.match(flat(pageSql("mapping", base, new Map()).kpi), /SELECT count\(\*\)::int AS total FROM f$/);
});

test("facetSql: number facets sort numerically, text facets alphabetically; live and unknown keys have none", () => {
  const dn = flat(facetSql("mapping", "dn", { ...base, filters: { dn: ["50"], pn: ["PN16"] } })!);
  assert.match(dn, new RegExp(`SELECT DISTINCT ${esc(cell("dn"))} AS v FROM l WHERE ${esc(cell("pn"))} IN \\(\\?\\)\\) d ORDER BY nullif\\(v, ''\\)::float8 NULLS FIRST LIMIT \\?$`));
  assert.match(flat(facetSql("stock", "make", base)!), /\) d ORDER BY v LIMIT \?$/);
  assert.equal(facetSql("stock", "live", base), null);
  assert.equal(facetSql("suitability", "gearbox", base), null);
});

test("codesSql: matrix columns by make then rating; actuators sum their ERP lines, gearboxes read their own code", () => {
  const s = flat(codesSql(new Map([["RED070005", 4]])));
  assert.match(s, /SELECT DISTINCT ON \(code\) code, kind, make, label, "ratingNm" FROM "ActuatorSuitability"/);
  assert.match(s, /WHEN c\.kind = 'GB' THEN coalesce\(\(SELECT v\.qty FROM live v WHERE v\.code = c\.code\), 0\)/);
  assert.match(s, /WHERE a\."actCode" = c\.code/);
  assert.match(s, /ORDER BY c\.make, coalesce\(c\."ratingNm", 0\), c\.label$/);
});

test("qtyOf: Physical Stock qty text to a number, anything else counts 0", () => {
  assert.equal(qtyOf("1,250"), 1250);
  assert.equal(qtyOf(" 3.5"), 3.5);
  for (const v of ["", null, "n/a"]) assert.equal(qtyOf(v), 0);
});

test("columns: filters are text or number; live quantities sort but never filter; stock tiles filter real columns", () => {
  for (const view of VIEW_KEYS) {
    const cols = VIEWS[view].columns;
    assert.ok(cols.length > 0 && cols.every((c) => c.kind === "text" || c.kind === "number"), view);
  }
  for (const key of ["rotorkAvailable", "gmdGbAvailable"]) assert.ok(VIEWS.mapping.columns.some((c) => c.key === key && c.sortable && !c.filter), key);
  assert.ok(VIEWS.stock.columns.some((c) => c.key === "live" && c.sortable && !c.filter));
  assert.deepEqual(VIEWS.suitability.columns.map((c) => c.key), ["valveType", "dn", "pn", "requiredTorque"]);
  for (const t of VIEWS.stock.kpis) {
    for (const key of Object.keys(t.filters ?? {})) assert.ok(VIEWS.stock.columns.some((c) => c.key === key && c.filter), `${t.key} -> ${key}`);
  }
});

test("slice: each view keeps its own query, filters reset the page, make is page-wide", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setPage({ view: "stock", page: 3 }));
  s = reducer(s, setFilter({ view: "stock", key: "make", values: ["AUMA"] }));
  s = reducer(s, setView("suitability"));
  s = reducer(s, setMake("Rotork"));
  assert.equal(s.view, "suitability");
  assert.equal(s.make, "Rotork");
  assert.deepEqual(queryOf(s.tables.stock).filters, { make: ["AUMA"] });
  assert.equal(s.tables.stock.page, 1);
  assert.deepEqual(s.tables.mapping.filters, {});
  s = reducer(s, clearFilters("stock"));
  assert.deepEqual(s.tables.stock.filters, {});
});

// Live DB smoke: ACTUATOR_MAPPING_SMOKE=1 QUOTATION_DATABASE_URL=... STOCK_DATABASE_URL=... pnpm test
test("pages and facets run against the quotation and stock DBs", { skip: !process.env.ACTUATOR_MAPPING_SMOKE }, async () => {
  for (const view of VIEW_KEYS) {
    const page = await listPage(view, { ...base, pageSize: 5 });
    console.log(view, JSON.stringify({ total: page.total, meta: { ...page.meta, codes: page.meta?.codes?.length }, first: page.rows[0] }));
    assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
    const facet = VIEWS[view].columns.find((c) => c.filter)!.key;
    assert.ok(Array.isArray(await listFacet(view, facet, base)));
  }
});
