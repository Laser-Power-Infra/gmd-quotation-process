import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { COLUMNS } from "../src/columns";
import { STOCK_COLUMNS, columnsFor } from "../src/stockColumns";
import { resolvePhysicalStockFlags } from "../src/flags";
import { buildOrderBy, buildWhere, listPhysicalStockFacet, listPhysicalStockPage } from "../src/server/query";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: ReturnType<typeof buildWhere>) => q.sql.replace(/\s+/g, " ");

test("every header has a stock column; flags hide and unlock columns", () => {
  assert.equal(STOCK_COLUMNS.length, COLUMNS.length);
  const cols = columnsFor(resolvePhysicalStockFlags({ hiddenColumns: ["COST"], editableColumns: ["REMARKS", "ERP CODE", "BOM ID"] }), { bomId: false });
  assert.ok(!cols.some((c) => c.key === "cost"));
  assert.equal(cols.find((c) => c.key === "remarks")?.edit, "text");
  assert.equal(cols.find((c) => c.key === "bom_id")?.edit, undefined); // host cannot save it
  const erp = cols.find((c) => c.key === "erp_code")!;
  assert.equal(erp.edit, "text");
  assert.equal(erp.canEdit!({ erp_code: "X" } as never), false);
  assert.equal(erp.canEdit!({ erp_code: "" } as never), true);
});

test("buildWhere: facets, blank, search, extras; unknown fields ignored", () => {
  const q = { ...base, filters: { l2_valve_type: ["SLUICE VALVE", BLANK], bogus: ["x"] }, search: "ab c" };
  const w = buildWhere(q);
  assert.match(flat(w), /btrim\(coalesce\(\(p\."l2_valve_type"\)::text, ''\)\) = \? OR .* = ''/);
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["SLUICE VALVE", "%abc%"]);
  assert.ok(!w.sql.includes("bogus"));
  assert.equal(buildWhere(base).sql, "TRUE");
  const extras = buildWhere({ ...base, extra: { card: "qty", majorMinor: ["yes", "blank"], duplicatesOnly: true } });
  assert.match(flat(extras), /available_qty.*> 0/);
  assert.match(flat(extras), /IS TRUE OR p\.majorminor_marking IS NULL/);
  assert.match(flat(extras), /EXISTS \(SELECT 1 FROM "PhysicalStock" d/);
  const contains = buildWhere({ ...base, columnSearch: { remarks: "ok go", bogus: "x" } });
  assert.match(flat(contains), /p\."remarks".*ILIKE \?/);
  assert.deepEqual(contains.values, ["%okgo%"]);
  assert.equal(buildWhere({ ...base, columnSearch: { remarks: "x" } }, "remarks").sql, "TRUE");
  const dated = buildWhere({ ...base, dateRanges: { form_date: { from: "2026-01-01", to: "2026-01-31" }, location: { from: "2026-01-01", to: "" } } });
  assert.match(flat(dated), /p\.form_date >= \?::date AND p\.form_date < \(\?::date \+ interval '1 day'\)/);
  assert.deepEqual(dated.values, ["2026-01-01", "2026-01-31"]); // location is not a date column
  // Facet of a column drops its own filter; major/minor counts drop that predicate.
  assert.equal(buildWhere({ ...base, filters: { l2_valve_type: ["X"] } }, "l2_valve_type").sql, "TRUE");
  assert.equal(buildWhere({ ...base, extra: { majorMinor: ["yes"] } }, "majorMinor").sql, "TRUE");
});

test("buildOrderBy by kind, fallback for unknown/none", () => {
  assert.match(flat(buildOrderBy({ key: "available_qty", dir: "desc" })), /::numeric END\) DESC NULLS LAST, p\.form_date DESC/);
  assert.match(flat(buildOrderBy({ key: "form_date", dir: "asc" })), /^p\.form_date ASC NULLS LAST/);
  assert.match(flat(buildOrderBy({ key: "location", dir: "desc" })), /NULLIF\(lower\(.*\), ''\) DESC NULLS FIRST/);
  assert.match(flat(buildOrderBy({ key: "in_transit", dir: "asc" })), /PurchaseOrderLine.*ASC NULLS LAST/);
  assert.equal(buildOrderBy({ key: "nope", dir: "asc" }).sql, buildOrderBy(null).sql);
});

// Live DB smoke (needs the derived-columns migration): STOCK_SMOKE=1 STOCK_DATABASE_URL=... pnpm test
test("page and facet queries run against the stock DB", { skip: !process.env.STOCK_SMOKE }, async () => {
  const facet = await listPhysicalStockFacet("l2_valve_type", base);
  assert.ok(facet.length > 0);
  const page = await listPhysicalStockPage(
    { ...base, pageSize: 5, sort: { key: "available_qty", dir: "desc" }, search: "valve", extra: { card: "qty", majorMinor: [], duplicatesOnly: false } },
    { duplicates: true },
  );
  assert.ok(page.rows.length <= 5 && page.total >= page.rows.length);
  assert.ok(page.meta!.totals.availableQty > 0);
  assert.ok("is_duplicate" in page.rows[0]);
});
