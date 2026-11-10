import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { buildOrderBy, buildWhere, listPurchaseFacet, listPurchaseLines, listPurchasePoPage } from "../src/server/query";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: ReturnType<typeof buildWhere>) => q.sql.replace(/\s+/g, " ");

test("buildWhere: facets, blank, search, dates, open only; unknown keys ignored", () => {
  const w = buildWhere({ ...base, filters: { supplier: ["ACME", BLANK], bogus: ["x"] }, search: "ab c", extra: { openOnly: true } });
  assert.match(flat(w), /\(l\."supplier" = \? OR l\."supplier" = ''\)/);
  assert.match(flat(w), /ILIKE \?/);
  assert.match(flat(w), /l\.open_qty > 0/);
  assert.deepEqual(w.values, ["ACME", "%abc%"]);
  assert.ok(!w.sql.includes("bogus"));
  assert.equal(buildWhere(base).sql, "TRUE");
  const dated = buildWhere({ ...base, dateRanges: { due: { from: "2026-01-01", to: "" }, supplier: { from: "2026-01-01", to: "" } }, columnSearch: { poNo: "pe 25", nope: "x" } });
  assert.match(flat(dated), /l\."due" >= \?::date/);
  assert.deepEqual(dated.values, ["%pe25%", "2026-01-01"]);
  // A key's own facet drops its filter.
  assert.equal(buildWhere({ ...base, filters: { status: ["Overdue"] } }, "status").sql, "TRUE");
});

test("buildOrderBy: sortable columns only, overdue-first fallback", () => {
  assert.match(flat(buildOrderBy(null)), /^"daysOverdue" DESC NULLS LAST/);
  assert.match(flat(buildOrderBy({ key: "openValue", dir: "asc" })), /^"openValue" ASC NULLS LAST, "daysOverdue"/);
  assert.match(flat(buildOrderBy({ key: "supplier", dir: "desc" })), /^NULLIF\(lower\("supplier"\), ''\) DESC NULLS FIRST/);
  assert.equal(buildOrderBy({ key: "balance", dir: "asc" }).sql, buildOrderBy(null).sql);
  assert.equal(buildOrderBy({ key: "x\"; drop", dir: "asc" }).sql, buildOrderBy(null).sql);
});

// Live DB smoke: PURCHASE_SMOKE=1 STOCK_DATABASE_URL=... pnpm test
test("page, facet and line queries run against the stock DB", { skip: !process.env.PURCHASE_SMOKE }, async () => {
  const open = { ...base, pageSize: 5, extra: { openOnly: true } };
  const page = await listPurchasePoPage(open);
  console.log(JSON.stringify({ total: page.total, kpi: page.meta!.kpi, first: page.rows[0], ageing: page.meta!.ageing, monthly: page.meta!.monthly, suppliers: page.meta!.suppliers.slice(0, 3) }, null, 1));
  assert.ok(page.rows.length > 0 && page.rows.length <= 5 && page.total >= page.rows.length);
  assert.ok(page.meta!.kpi.inTransitValue > 0);
  const statuses = await listPurchaseFacet("status", open);
  assert.ok(statuses.length > 0 && !statuses.includes("Received"));
  const lines = await listPurchaseLines(page.rows[0].poNo, open);
  assert.equal(lines.length, page.rows[0].lines);
  const filtered = await listPurchasePoPage({ ...open, filters: { supplier: [page.rows[0].supplier] }, sort: { key: "openValue", dir: "desc" } });
  assert.ok(filtered.rows.every((r) => r.supplier === page.rows[0].supplier));
  assert.ok(filtered.meta!.kpi.inTransitValue <= page.meta!.kpi.inTransitValue);
});
