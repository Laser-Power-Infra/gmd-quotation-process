import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { ERP_DIFFERS, NEEDS_CODE, OVER_TIME, VIEWS, VIEW_KEYS } from "../src/columns";
import { buildOrderBy, buildWhere, codesSql, facetSql, listFacet, listPage, pageSql, qtyOf } from "../src/server/query";
import reducer, { clearFilters, queryOf, setFilter, setMake, setPage, setView } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");
const cell = (key: string) => `btrim(coalesce(l."${key}"::text, ''))`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("buildWhere: text and number facets match the cell text, blank is ''; unknown, live and other-view keys are ignored", () => {
  const w = buildWhere("mapping", {
    ...base,
    filters: { valveType: ["BUTTERFLY VALVE", BLANK], dn: ["200"], gmdGbAvailable: ["3"], kind: ["Gearbox"], bogus: ["x"] },
    search: "pn 16",
  });
  assert.match(flat(w), new RegExp(`${esc(cell("valveType"))} IN \\(\\?,\\?\\)`));
  assert.match(flat(w), new RegExp(`${esc(cell("dn"))} IN \\(\\?\\)`));
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["BUTTERFLY VALVE", "", "200", "%pn16%"]);
  assert.ok(!/gmdGbAvailable|kind|bogus/.test(w.sql));
  assert.equal(buildWhere("stock", base).sql, "TRUE");
  // A column's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere("mapping", { ...base, filters: { dn: ["200"] } }, "dn").sql, "TRUE");
  // The matrix filters on its own columns only.
  assert.equal(buildWhere("suitability", { ...base, filters: { selGearbox: ["x"] } }).sql, "TRUE");
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
  assert.equal(buildOrderBy("suitability", { key: "selGearbox", dir: "asc" }).sql, buildOrderBy("suitability", null).sql);
  assert.match(flat(buildOrderBy("mapping", null)), /^f\."origin" DESC, f\."valveType", f\."dn", f\."pn"/);
  assert.match(flat(buildOrderBy("suitability", null)), /^f\."valveType", f\."dn", f\."pn"/);
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
  // Stock value: no coalesce to 0, so a sheet without the STOCK VALUE column gives null and the tile shows "–", not Rs 0.
  assert.ok(flat(q.kpi).includes(`(sum("stockValue") FILTER (WHERE "kind" = 'Actuator'))::float8 AS "value"`));
  assert.ok(!flat(q.kpi).includes('coalesce(sum("stockValue")'));
  assert.match(flat(pageSql("suitability", base, new Map()).kpi), /SELECT count\(\*\)::int AS total FROM f$/);
});

test("facetSql: number facets sort numerically, text facets alphabetically; live and unknown keys have none", () => {
  const dn = flat(facetSql("mapping", "dn", { ...base, filters: { dn: ["50"], pn: ["PN16"] } })!);
  assert.match(dn, new RegExp(`SELECT DISTINCT ${esc(cell("dn"))} AS v FROM l WHERE ${esc(cell("pn"))} IN \\(\\?\\)\\) d ORDER BY nullif\\(v, ''\\)::float8 NULLS FIRST LIMIT \\?$`));
  assert.match(flat(facetSql("stock", "make", base)!), /\) d ORDER BY v LIMIT \?$/);
  assert.equal(facetSql("stock", "live", base), null);
  assert.equal(facetSql("suitability", "selGearbox", base), null);
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
  assert.ok(VIEWS.mapping.columns.some((c) => c.key === "gmdGbAvailable" && c.sortable && !c.filter));
  assert.ok(VIEWS.stock.columns.some((c) => c.key === "live" && c.sortable && !c.filter));
  assert.deepEqual(VIEWS.suitability.columns.map((c) => c.key), ["valveType", "dn", "pn", "requiredTorque"]);
  for (const t of [...VIEWS.stock.kpis.map((t) => ({ ...t, view: "stock" as const })), ...VIEWS.mapping.kpis.map((t) => ({ ...t, view: "mapping" as const }))]) {
    for (const key of Object.keys(t.filters ?? {})) assert.ok(VIEWS[t.view].columns.some((c) => c.key === key && c.filter), `${t.key} -> ${key}`);
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

test("mapping view: the app's pick per row, Origin and Time check as server facets, 'Over 2 min' counted in SQL; old AUMA GS / Rotork columns gone", () => {
  const keys = VIEWS.mapping.columns.map((c) => c.key);
  assert.deepEqual(keys, ["origin", "valveType", "dn", "pn", "requiredTorque", "valveTurns", "selGearbox", "selGbRatio", "selActuator", "selActRpm",
    "selTotal", "selTime", "selTimeCheck", "selFlags", "valveFlange", "flangeCheck", "gmdGbCode", "gmdGbRating", "gmdGbAvailable"]);
  const q = pageSql("mapping", { ...base, filters: { origin: ["IMPORTED"], selTimeCheck: [OVER_TIME] } }, new Map());
  const rows = flat(q.rows);
  // Every column the page shows is selected by the lines query, and nothing of the old logic is.
  for (const k of keys) assert.ok(rows.includes(`f."${k}"`) && (k === "origin" || k === "gmdGbAvailable" || rows.includes(`m."${k}"`)), k);
  assert.ok(!/"gearbox"|"aumaModel"|"rotorkModel"|"stockRotorkNm"|"actInputTorque"|"gbFactor"/.test(rows));
  // Rows stored before the first refresh have no origin: they read as INDIAN, and the filter matches that.
  assert.match(rows, /coalesce\(m\."origin", 'INDIAN'\) AS "origin"/);
  assert.match(rows, new RegExp(`${esc(cell("origin"))} IN \\(\\?\\) AND ${esc(cell("selTimeCheck"))} IN \\(\\?\\)`));
  assert.match(flat(q.kpi), /SELECT count\(\*\)::int AS total, \(count\(\*\) FILTER \(WHERE "selTimeCheck" = \?\)\)::int AS "overTime" FROM f$/);
  assert.ok(q.kpi.values.includes(OVER_TIME));
  assert.deepEqual(VIEWS.mapping.kpis.map((t) => [t.key, t.label, t.filters]), [["overTime", "Over 2 min", { selTimeCheck: ["Over 2 min"] }]]);
  // Facet options come from the server, under the other active filters.
  for (const key of ["origin", "selTimeCheck"]) {
    const f = flat(facetSql("mapping", key, { ...base, filters: { origin: ["IMPORTED"], selTimeCheck: [OVER_TIME] } })!);
    const other = key === "origin" ? "selTimeCheck" : "origin";
    assert.match(f, new RegExp(`SELECT DISTINCT ${esc(cell(key))} AS v FROM l WHERE ${esc(cell(other))} IN \\(\\?\\)\\) d ORDER BY v LIMIT \\?$`));
  }
  // The matrix lists Indian rows only (SUITABILITY has no marks for imported keys).
  assert.match(flat(pageSql("suitability", base, new Map()).rows), /\) s WHERE s\."origin" = 'INDIAN'\)/);
});
