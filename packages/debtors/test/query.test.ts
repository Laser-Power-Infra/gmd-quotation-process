import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { buildOrderBy, buildWhere, contextFor, partiesCte } from "../src/server/query";

const c = contextFor(new Date(2026, 10, 19), { bankRatePct: 5.75, creditDaysNoAgreement: 15 }); // Thu 19 Nov 2026
const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

test("contextFor: local today and the Monday of its week", () => {
  assert.equal(c.today, "2026-11-19");
  assert.equal(c.weekStart, "2026-11-16");
  assert.equal(contextFor(new Date(2026, 10, 16), c).weekStart, "2026-11-16"); // Monday itself
  assert.equal(contextFor(new Date(2026, 10, 22), c).weekStart, "2026-11-16"); // Sunday
});

test("buildWhere: litigating parties only in their own view", () => {
  assert.equal(buildWhere(base, c).sql, "NOT r.litigating");
  assert.equal(buildWhere({ ...base, extra: { view: "litigation" } }, c).sql, "r.litigating");
});

test("buildWhere: facets, blank, search; unknown or non-filter columns ignored", () => {
  const w = buildWhere({ ...base, filters: { owner: ["Asha", BLANK], accCode: ["X"], bogus: ["y"] }, search: "Ab C" }, c);
  assert.match(flat(w), /\(btrim\(coalesce\(r\."owner"::text, ''\)\) = \? OR btrim\(coalesce\(r\."owner"::text, ''\)\) = ''\)/);
  assert.ok(!w.sql.includes("accCode\"::text") && !w.sql.includes("bogus"));
  assert.deepEqual(w.values, ["Asha", "%abc%"]);
  // A column's facet drops its own filter.
  assert.equal(buildWhere({ ...base, filters: { owner: ["Asha"] } }, c, "owner").sql, "NOT r.litigating");
});

test("buildWhere: views, bucket, promised this week, date ranges", () => {
  assert.match(flat(buildWhere({ ...base, extra: { view: "breach" } }, c)), /r\."msmeDays" > 0/);
  assert.match(flat(buildWhere({ ...base, extra: { view: "over45" } }, c)), /r\."b61_90" \+ r\."b91_180" \+ r\."b180" > 0/);
  const today = buildWhere({ ...base, extra: { view: "today" } }, c);
  assert.match(flat(today), /r\."nextActionDate" <= \? OR \(r\."promisedDay" < \?::date AND r\.overdue > 0\)/);
  assert.deepEqual(today.values, ["2026-11-19", "2026-11-19"]);
  assert.match(flat(buildWhere({ ...base, extra: { bucket: "91-180" } }, c)), /r\."b91_180" > 0/);
  const week = buildWhere({ ...base, extra: { weekOnly: true } }, c);
  assert.deepEqual(week.values, ["2026-11-16", "2026-11-16"]);
  const dated = buildWhere({ ...base, dateRanges: { promisedDate: { from: "2026-11-01", to: "" }, owner: { from: "x", to: "y" } } }, c);
  assert.match(flat(dated), /r\."promisedDate" >= \?/);
  assert.deepEqual(dated.values, ["2026-11-01"]); // owner is not a date column
});

test("buildOrderBy: numbers, stored-text amounts, text; fallback for unknown", () => {
  assert.match(flat(buildOrderBy({ key: "overdue", dir: "desc" })), /^r\."overdue" DESC NULLS LAST, r\.overdue DESC/);
  assert.match(flat(buildOrderBy({ key: "promisedAmount", dir: "asc" })), /NULLIF\(btrim\(.*\), ''\)::numeric ASC NULLS LAST/);
  assert.match(flat(buildOrderBy({ key: "owner", dir: "desc" })), /NULLIF\(lower\(.*\), ''\) DESC NULLS FIRST/);
  assert.equal(buildOrderBy({ key: "nope", dir: "asc" }).sql, buildOrderBy(null).sql);
});

test("partiesCte binds today and the MSME settings", () => {
  const cte = partiesCte(c);
  assert.ok(cte.values.includes("2026-11-19") && cte.values.includes(15) && cte.values.includes(5.75));
});
