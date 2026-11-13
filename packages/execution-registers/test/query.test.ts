import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { REGISTERS, REGISTER_KEYS } from "../src/columns";
import { buildOrderBy, buildWhere, listRegisterFacet, listRegisterPage, pageSql } from "../src/server/query";
import reducer, { queryOf, setFilter, setPage, setTab } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

test("buildWhere: facets, blank, search; keys of another register are ignored", () => {
  const w = buildWhere("dispatch", { ...base, filters: { party: ["ACME", BLANK], bogus: ["x"], mcNo: ["OD1"] }, search: "ab c" });
  assert.match(flat(w), /\(l\."party" = \? OR l\."party" = ''\)/);
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["ACME", "%abc%"]);
  assert.ok(!w.sql.includes("bogus") && !w.sql.includes("mcNo"));
  assert.equal(buildWhere("mc", base).sql, "TRUE");
  // A key's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere("mc", { ...base, filters: { status: ["Open"] } }, "status").sql, "TRUE");
});

test("buildWhere: date ranges on date columns only, column search squashes spaces", () => {
  const w = buildWhere("production", {
    ...base,
    dateRanges: { prodOrderDate: { from: "2026-01-01", to: "2026-01-31" }, status: { from: "2026-01-01", to: "" } },
    columnSearch: { prodOrderNo: "p1 23", nope: "x" },
  });
  assert.match(flat(w), /l\."prodOrderNo"/);
  assert.match(flat(w), /l\."prodOrderDate" >= \?::date AND l\."prodOrderDate" <= \?::date/);
  assert.deepEqual(w.values, ["%p123%", "2026-01-01", "2026-01-31"]);
  assert.ok(!w.sql.includes("nope") && !w.sql.includes('l."status"'));
});

test("buildOrderBy: sortable columns only, text vs number, register fallback", () => {
  const fallback = buildOrderBy("mc", null).sql;
  assert.match(flat(buildOrderBy("mc", { key: "balanceQty", dir: "asc" })), /^f\."balanceQty" ASC NULLS LAST, /);
  assert.match(flat(buildOrderBy("mc", { key: "party", dir: "desc" })), /^NULLIF\(lower\(f\."party"\), ''\) DESC NULLS FIRST, /);
  assert.ok(buildOrderBy("mc", { key: "party", dir: "desc" }).sql.endsWith(fallback));
  assert.equal(buildOrderBy("mc", { key: "lrStatus", dir: "asc" }).sql, fallback); // a dispatch column
  assert.equal(buildOrderBy("mc", { key: 'x"; drop', dir: "asc" }).sql, fallback);
  assert.match(flat(buildOrderBy("dispatch", null)), /^f\."invoiceDate" DESC NULLS LAST/);
});

test("pageSql: page size is capped and dates leave as ISO text", () => {
  const q = pageSql("dispatch", { ...base, page: 2, pageSize: 1000 });
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 200]);
  assert.match(flat(q.rows), /to_char\(f\."invoiceDate", 'YYYY-MM-DD'\) AS "invoiceDate"/);
  assert.match(flat(q.kpi), /count\(\*\)::int AS total/);
});

test("every register column the server filters on exists in its column list", () => {
  for (const key of REGISTER_KEYS) {
    const cols = REGISTERS[key].columns;
    assert.ok(cols.length > 0 && cols.every((c) => !c.filter || c.kind === "text" || c.kind === "date"), key);
    assert.ok(REGISTERS[key].kpis.length > 0, key);
  }
});

test("slice: each register keeps its own query; filters reset the page", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setPage({ register: "mc", page: 3 }));
  s = reducer(s, setFilter({ register: "mc", key: "status", values: ["Open"] }));
  s = reducer(s, setTab("production"));
  assert.equal(s.tab, "production");
  assert.deepEqual(queryOf(s.tables.mc).filters, { status: ["Open"] });
  assert.equal(s.tables.mc.page, 1);
  assert.deepEqual(s.tables.dispatch.filters, {});
  s = reducer(s, setFilter({ register: "mc", key: "status", values: [] }));
  assert.deepEqual(s.tables.mc.filters, {});
});

// Live DB smoke: EXEC_REGISTERS_SMOKE=1 QUOTATION_DATABASE_URL=... pnpm test (MC / production need the migration).
test("page and facet queries run against the quotation DB", { skip: !process.env.EXEC_REGISTERS_SMOKE }, async () => {
  for (const key of REGISTER_KEYS) {
    const page = await listRegisterPage(key, { ...base, pageSize: 5 });
    console.log(key, JSON.stringify({ total: page.total, meta: page.meta, first: page.rows[0] }));
    assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
    const facetKey = REGISTERS[key].columns.find((c) => c.filter && c.kind === "text")!.key;
    const values = await listRegisterFacet(key, facetKey, base);
    assert.ok(Array.isArray(values));
  }
});
