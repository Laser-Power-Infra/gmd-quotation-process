import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { buildOrderBy, buildPoWhere, buildWhere, facetSql, listPurchaseFacet, listPurchaseLines, listPurchasePoPage, pageSql } from "../src/server/query";

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

test("per-PO figure filters: own WHERE over pa, applied to f, skipped for their own facet", () => {
  const q = { ...base, filters: { lines: ["2", BLANK], supplier: ["ACME"] }, columnSearch: { balance: "5 pcs" } };
  const w = buildPoWhere(q)!;
  assert.match(flat(w), /\(pa\."lines" = \? OR pa\."lines" = ''\) AND regexp_replace\(pa\."balance"/);
  assert.deepEqual(w.values, ["2", "%5pcs%"]);
  assert.ok(!buildWhere(q).sql.includes("lines"));
  assert.equal(buildPoWhere(base), null);
  assert.equal(buildPoWhere({ ...base, filters: { lines: ["2"] } }, "lines"), null);
  assert.match(flat(pageSql(q).kpi), /g\.po_no IN \(SELECT pa\.po_no FROM pa WHERE/);
  assert.ok(!pageSql(base).kpi.sql.includes("g.po_no IN"));
  assert.match(flat(facetSql("openValue", q)!), /ORDER BY nullif\(pa\."openValue", ''\)::numeric NULLS FIRST/);
  assert.equal(facetSql("payableNet", q), null);
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

test("figure filters run against the stock DB and narrow to the picked value", { skip: !process.env.PURCHASE_SMOKE }, async () => {
  const open = { ...base, pageSize: 5, extra: { openOnly: true } };
  for (const key of ["daysOverdue", "lines", "balance", "receivedPct", "orderedValue", "openValue"] as const) {
    const options = await listPurchaseFacet(key, open);
    const pick = options[options.length - 1];
    const page = await listPurchasePoPage({ ...open, filters: { [key]: [pick] } });
    console.log(key, options.length, "options, picked", pick, "->", page.total, "POs");
    assert.ok(page.total > 0);
    const shown = (r: (typeof page.rows)[number]) => (key === "balance" ? r.balance : key === "receivedPct" ? Math.round(r.receivedPct!) : Math.round(Number(r[key]) * 100) / 100);
    assert.ok(page.rows.every((r) => String(shown(r)) === pick), `${key}: ${JSON.stringify(page.rows.map(shown))} vs ${pick}`);
  }
  assert.ok((await listPurchaseFacet("supplierCode", open, 100000)).length > 0);
});
