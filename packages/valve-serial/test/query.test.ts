import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { buildOrderBy, buildWhere, listValveSerialFacet, listValveSerialPage, pageSql } from "../src/server";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

test("buildWhere: facets with blank, supply join, search; values are bound, unknown and host-filled keys ignored", () => {
  const w = buildWhere({
    ...base,
    filters: { valveType: ["SLUICE VALVE", BLANK], supplyParty: ["NCC LIMITED"], bogus: ["x"], stockLocation: ["SHED"] },
    search: "rs lv%_",
  });
  assert.match(flat(w), /\(btrim\(coalesce\(v\."valveType", ''\)\) = \? OR btrim\(coalesce\(v\."valveType", ''\)\) = ''\)/);
  assert.match(flat(w), /btrim\(coalesce\(s\."partyName", ''\)\) = \?/);
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["SLUICE VALVE", "NCC LIMITED", "%rslv\\%\\_%"]);
  assert.ok(!/bogus|stockLocation|SLUICE|NCC/.test(w.sql));
  assert.equal(buildWhere(base).sql, "TRUE");
});

test("buildWhere: contains text, date ranges on date columns only, and a facet drops its own filter", () => {
  const w = buildWhere({
    ...base,
    columnSearch: { serialNo: "rslv 40", nope: "x" },
    dateRanges: { invoiceDate: { from: "2026-01-01", to: "2026-01-31" }, valveType: { from: "2026-01-01", to: "" } },
  });
  assert.match(flat(w), /regexp_replace\(btrim\(coalesce\(v\."serialNo", ''\)\), '\[\[:space:\]\]', '', 'g'\) ILIKE \?/);
  assert.match(flat(w), /make_date\(.*v\."invoiceDate".*\) >= \?::date AND .* <= \?::date/);
  assert.deepEqual(w.values, ["%rslv40%", "2026-01-01", "2026-01-31"]);
  assert.equal(buildWhere({ ...base, filters: { valveType: ["X"] }, columnSearch: { valveType: "y" } }, "valveType").sql, "TRUE");
});

test("buildOrderBy: by column kind; unknown, host-filled and injected keys fall back", () => {
  const fallback = buildOrderBy(null).sql;
  assert.match(fallback, /^v\."updatedAt" DESC, v\."serialNo" ASC$/);
  assert.match(flat(buildOrderBy({ key: "sizeDn", dir: "asc" })), /::numeric END\) ASC NULLS LAST, v\."updatedAt" DESC/);
  assert.match(flat(buildOrderBy({ key: "invoiceDate", dir: "desc" })), /make_date\(.*\) DESC NULLS LAST, v\."updatedAt"/);
  assert.match(flat(buildOrderBy({ key: "valveType", dir: "desc" })), /^NULLIF\(lower\(btrim\(coalesce\(v\."valveType", ''\)\)\), ''\) DESC NULLS FIRST/);
  assert.match(flat(buildOrderBy({ key: "supplyParty", dir: "asc" })), /s\."partyName"/);
  // Supply History dates are dd-MMM-yyyy text: sorted (and range-filtered) as dates, not as text.
  assert.match(flat(buildOrderBy({ key: "supplyDate", dir: "asc" })), /array_position\(.*split_part\(btrim\(coalesce\(s\."date", ''\)\), '-', 2\).*\) ASC NULLS LAST/);
  assert.match(flat(buildWhere({ ...base, dateRanges: { supplyDate: { from: "2025-12-01", to: "" } } })), /s\."date".* >= \?::date$/);
  for (const key of ["nope", "stockLocation", 'x"; drop table valve_serial; --']) assert.equal(buildOrderBy({ key, dir: "asc" }).sql, fallback);
});

test("pageSql: page size capped at 200, supply line joined by invoice no", () => {
  const q = pageSql({ ...base, page: 3, pageSize: 999 });
  assert.deepEqual(q.rows.values.slice(-2), [200, 400]);
  assert.match(flat(q.rows), /LEFT JOIN LATERAL \( ?SELECT .* FROM "SupplyHistoryItem" h WHERE h\."invoiceNo" = v\."invoiceNo" ORDER BY h\."itemName" LIMIT 1 ?\) s ON TRUE/);
  assert.match(flat(q.count), /^SELECT count\(\*\)::int AS total FROM "valve_serial" v/);
});

// Live DB smoke (after db:deploy of 20261114100000): VALVE_SERIAL_SMOKE=1 QUOTATION_DATABASE_URL=... pnpm test
test("page and facet queries run against the quotation DB", { skip: !process.env.VALVE_SERIAL_SMOKE }, async () => {
  const page = await listValveSerialPage({ ...base, pageSize: 5, sort: { key: "invoiceDate", dir: "desc" }, search: "v" });
  assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
  const types = await listValveSerialFacet("valveType", base);
  assert.ok(Array.isArray(types));
});
