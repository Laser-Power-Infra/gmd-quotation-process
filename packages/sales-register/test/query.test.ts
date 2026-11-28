import test from "node:test";
import assert from "node:assert/strict";
import { addLine, currentFy, emptyCell, fiscalMonths, fyVariants, gpOf, pivotColumns, saleMoney, viewValue } from "../src/columns";
import { buildWhere, linesSql, listSalesFacet, listSalesPage, optionsOf, pivot } from "../src/server/query";
import reducer, { queryOf, setFilter, setFy, setGroup, setSort } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

// ---- Gross profit math (moved from the app's tests/executionPages.test.ts) ----

const line = (value: number, cost: number | null, minVa = 0, quotedCost: number | null = null) => ({ value, cost, minVa, quotedCost });
const cellOf = (...lines: ReturnType<typeof line>[]) => lines.reduce(addLine, emptyCell());
// Minimum VA% (lib/vaRules.ts, tested in the app): resilient sluice 15, metal sluice 30, plug valve 100.
const RESILIENT = 15;
const METAL = 30;
const PLUG = 100;

test("cost missing: its sales count, but GP and GP % cover only the costed lines", () => {
  const c = cellOf(line(100_000, 80_000), line(50_000, null));
  assert.equal(c.sales, 150_000);
  assert.equal(c.missingSales, 50_000);
  assert.equal(c.missingLines, 1);
  const g = gpOf(c);
  assert.equal(g.gp, 20_000);
  assert.equal(g.gpPct, 20); // not 13.3 (missing as zero GP), not 46.7 (missing as zero cost)
  // only missing lines: no GP at all, never 100%
  assert.deepEqual(gpOf(cellOf(line(50_000, null))), { gp: null, gpPct: null, red: false, quotedGpPct: null });
  // quoted GP % is over the lines the Quotation app has a cost for
  assert.equal(gpOf(cellOf(line(100_000, 80_000, 0, 75_000), line(50_000, null))).quotedGpPct, 25);
});

test("a blank sales value is cost missing, never costed against ₹0 of sales", () => {
  assert.deepEqual(saleMoney("10", "12,000", 1_000, 900), { qty: 10, value: 12_000, cost: 10_000, quotedCost: 9_000 });
  // SALE BILL inserts carry qty and code but no value until MASTER covers the row
  assert.deepEqual(saleMoney("10", null, 1_000, 900), { qty: 10, value: 0, cost: null, quotedCost: null });
  assert.deepEqual(saleMoney("10", " ", 1_000, null), { qty: 10, value: 0, cost: null, quotedCost: null });
  const unpriced = { ...saleMoney("10", null, 1_000, null), minVa: 0 };
  const c = cellOf(line(100_000, 80_000), unpriced);
  assert.equal(gpOf(c).gpPct, 20); // no phantom loss
  assert.equal(c.missingLines, 1);
});

test("weighted: the All row adds the lines, never averages the percentages", () => {
  assert.equal(gpOf(cellOf(line(100, 50))).gpPct, 50);
  assert.equal(gpOf(cellOf(line(900, 810))).gpPct, 10);
  assert.equal(gpOf(cellOf(line(100, 50), line(900, 810))).gpPct, 14); // not 30
});

// VA% is a mark-up on cost (rate = cost × (1 + VA/100)), so the GP floor is sales × VA ÷ (100 + VA):
// 15% on cost = 13.0% of sales, 30% = 23.1%, 100% = 50%.
test("red: GP below the minimum VA% of the valve type, sales-weighted", () => {
  assert.equal(gpOf(cellOf(line(100_000, 87_700, RESILIENT))).red, true); // GP 12.3% of sales < 13.0%
  assert.equal(gpOf(cellOf(line(100_000, 83_300, RESILIENT))).red, false); // 16.7% >= 13.0%
  assert.equal(gpOf(cellOf(line(100_000, 83_300, METAL))).red, true); // 16.7% < 23.1%
  // mixed cell: GP 33,400 against a floor of 13,043 + 23,077
  assert.equal(gpOf(cellOf(line(100_000, 83_300, RESILIENT), line(100_000, 83_300, METAL))).red, true);
});

test("red floor reads VA% as a mark-up on cost: a plug valve at 90% GP is not red; a sale at the minimum sits on the line", () => {
  assert.equal(gpOf(cellOf(line(100_000, 10_000, PLUG))).red, false);
  // priced exactly at the minimum (cost × 2): floor = GP, not red; a rupee less is red
  const atMin = cellOf(line(100_000, 50_000, PLUG));
  assert.equal(atMin.minGp, 50_000);
  assert.equal(gpOf(atMin).red, false);
  assert.equal(gpOf(cellOf(line(99_999, 50_000, PLUG))).red, true);
  // the same for 15%: cost 1,00,000 sold at 1,15,000
  assert.equal(gpOf(cellOf(line(115_000, 100_000, RESILIENT))).red, false);
});

// ---- Fiscal year, query options, SQL ----

test("fiscal year helpers", () => {
  const m = fiscalMonths("2026-27");
  assert.equal(m[0], "2026-04");
  assert.equal(m[11], "2027-03");
  assert.equal(currentFy(new Date(2026, 3, 1)), "2026-27");
  assert.equal(currentFy(new Date(2027, 2, 31)), "2026-27");
  assert.deepEqual(fyVariants("2026-27"), ["2026-27", "26-27", "2026-2027", "2627", "26_27"]);
});

test("optionsOf: an unknown year, grouping or view falls back to this year, by party, in sales", () => {
  assert.deepEqual(optionsOf({ ...base, extra: { fy: "2025-26", group: "size", view: "gpPct" } }), { fy: "2025-26", group: "size", view: "gpPct" });
  assert.deepEqual(optionsOf({ ...base, extra: { fy: "2025'; drop", group: "invoiceNo", view: "x" } }), { fy: currentFy(), group: "party", view: "sales" });
  assert.deepEqual(optionsOf(base), { fy: currentFy(), group: "party", view: "sales" });
});

test("buildWhere: dimension and month filters, per-dimension contains, search; other keys ignored", () => {
  const w = buildWhere({
    ...base,
    filters: { party: ["ACME", "BETA"], month: ["2026-04"], invoiceNo: ["X"], bogus: ["y"] },
    columnSearch: { valveType: "slu ice", amount: "1" },
    search: "gate v",
  });
  assert.match(flat(w), /^l\."party" = ANY\(\?::text\[\]\) AND l\."month" = ANY\(\?::text\[\]\) AND regexp_replace\(l\."valveType"/);
  assert.deepEqual(w.values, [["ACME", "BETA"], ["2026-04"], "%sluice%", "%gatev%"]);
  assert.ok(!w.sql.includes("bogus") && !w.sql.includes('l."amount"') && !w.sql.includes('l."invoiceNo" ='));
  // A key's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere({ ...base, filters: { size: ["100"] } }, "size").sql, "TRUE");
});

test("linesSql: the year's spellings; item masters before keywords before the label", () => {
  const s = linesSql("2026-27", { labels: ["Gate Valve"], types: ["SLUICE VALVE-RESILIENT-RISING"] });
  assert.ok(s.values.some((v) => Array.isArray(v) && v.includes("26-27") && v.includes("2026-2027")));
  assert.ok(s.values.some((v) => Array.isArray(v) && v[0] === "Gate Valve"));
  assert.match(flat(s), /coalesce\(nullif\(btrim\(fi\."itemType"\), ''\), nullif\(btrim\(rm\."l2ValveType"\), ''\), kw\.type, nullif\(/);
  // A blank code never matches an item master row.
  assert.match(flat(s), /LEFT JOIN "FullItem" fi ON .* <> '' AND fi\."itemCode" = /);
});

// ---- The pivot ----

const sale = (party: string, valveType: string, month: string, value: number, cost: number | null = null) =>
  ({ party, valveType, size: "-", pressureClass: "-", month, value, cost, minVa: 0, quotedCost: null });
const LINES = [sale("A", "BFV", "2026-04", 100, 80), sale("B", "BFV", "2026-05", 300, 200), sale("A", "GV", "", 50)];

test("pivot: groups by the chosen dimension, biggest sales first; All adds every line; undated lines count in totals only", () => {
  const { rows, all } = pivot(LINES, "party", "sales", null);
  assert.deepEqual(rows.map((r) => [r.key, r.total.sales]), [["B", 300], ["A", 150]]);
  assert.deepEqual(Object.keys(rows[1].byMonth), ["2026-04"]);
  assert.equal(all.total.sales, 450);
  assert.equal(all.total.lines, 3);
  assert.equal(all.byMonth["2026-05"].sales, 300);
  assert.deepEqual(pivot(LINES, "valveType", "sales", null).rows.map((r) => [r.key, r.total.lines]), [["BFV", 2], ["GV", 1]]);
});

test("pivot sort: the group, the total or a month, by its value in the view; no value sorts last", () => {
  const keys = (sort: Parameters<typeof pivot>[3], view: Parameters<typeof pivot>[2] = "sales") => pivot(LINES, "party", view, sort).rows.map((r) => r.key);
  assert.deepEqual(keys({ key: "party", dir: "asc" }), ["A", "B"]);
  assert.deepEqual(keys({ key: "total", dir: "asc" }), ["A", "B"]);
  // GP %: A = 20% (its GV line has no cost), B = 33.3%
  assert.deepEqual(keys({ key: "total", dir: "desc" }, "gpPct"), ["B", "A"]);
  // May: only B sold, so A has no value and goes last both ways
  assert.deepEqual(keys({ key: "2026-05", dir: "asc" }), ["B", "A"]);
  assert.deepEqual(keys({ key: "2026-05", dir: "desc" }), ["B", "A"]);
  // A key that is not a column leaves the sales order.
  assert.deepEqual(keys({ key: "size", dir: "asc" }), ["B", "A"]);
  assert.equal(viewValue(undefined, "sales"), null);
  assert.equal(viewValue(cellOf(line(100, null)), "cost"), null);
});

test("pivotColumns: the group (filterable), one per month, the total", () => {
  const cols = pivotColumns("valveType", ["2026-04", "2026-05"]);
  assert.deepEqual(cols.map((c) => c.key), ["valveType", "2026-04", "2026-05", "total"]);
  assert.ok(cols[0].filter && cols[0].sortable && cols.every((c) => c.sortable));
  assert.ok(cols.slice(1).every((c) => !c.filter && c.kind === "number"));
});

test("slice: another year drops the month filter; another grouping drops a sort on the old group", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setFilter({ key: "month", values: ["2026-04"] }));
  s = reducer(s, setFilter({ key: "party", values: ["ACME"] }));
  s = reducer(s, setFy("2025-26"));
  assert.deepEqual(s.filters, { party: ["ACME"] });
  s = reducer(s, setSort({ key: "party", dir: "asc" }));
  s = reducer(s, setGroup("size"));
  assert.equal(s.sort, null);
  s = reducer(s, setSort({ key: "total", dir: "desc" }));
  s = reducer(s, setGroup("party"));
  assert.deepEqual(s.sort, { key: "total", dir: "desc" });
  assert.deepEqual(queryOf(s).extra, { fy: "2025-26", group: "party", view: "sales" });
});

// ---- Live DB: SALES_REGISTER_SMOKE=1 with QUOTATION_DATABASE_URL set. Reads only; costs are left missing. ----

test("live: groups match the old JS register for this year", { skip: !process.env.SALES_REGISTER_SMOKE }, async () => {
  const { prisma } = await import("@gmd/db-quotation");
  const { matchItemType } = await import("@gmd/dashboard/lib/itemTypePatterns");
  const { parseGmdDate } = await import("@gmd/ui/lib/dateParse");
  const fy = process.env.SALES_REGISTER_FY ?? currentFy();
  const noCost = async (lines: unknown[]) => lines.map(() => ({ unitCost: null, quotedUnitCost: null, minVa: 0 }));

  // The old getSalesLines, read the old way.
  const text = (v: string | null | undefined) => (v ?? "").trim();
  const key = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  const rows = await prisma.supplyHistoryItem.findMany({
    where: { financialYear: { in: fyVariants(fy) } },
    select: { invoiceNo: true, date: true, consigneeName: true, erpPartyName: true, partyName: true, typeOfValve: true, derivedItemType: true, sizeOfValve: true, derivedSize: true, classOfValve: true, value: true, erpItemCode: true },
  });
  const codes = [...new Set(rows.map((r) => key(r.erpItemCode)).filter(Boolean))];
  const types = new Map<string, string>();
  for (const f of await prisma.fullItem.findMany({ where: { itemCode: { in: codes } }, select: { itemCode: true, itemType: true } }))
    if (text(f.itemType) && !types.has(key(f.itemCode))) types.set(key(f.itemCode), text(f.itemType));
  const rest = codes.filter((c) => !types.has(c));
  for (const r of await prisma.rawMaterial.findMany({ where: { erpItemCode: { in: rest } }, select: { erpItemCode: true, l2ValveType: true } }))
    if (text(r.l2ValveType) && !types.has(key(r.erpItemCode))) types.set(key(r.erpItemCode), text(r.l2ValveType));
  const old = rows.map((r) => {
    const label = text(r.typeOfValve) || text(r.derivedItemType);
    const d = parseGmdDate(r.date);
    return {
      party: text(r.erpPartyName) || text(r.consigneeName) || text(r.partyName) || "-",
      valveType: types.get(key(r.erpItemCode))?.trim() || matchItemType(label) || label.trim() || "-",
      size: text(r.sizeOfValve) || text(r.derivedSize) || "-",
      pressureClass: text(r.classOfValve) || "-",
      month: d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "",
      value: saleMoney(null, r.value, null, null).value,
    };
  });

  for (const group of ["party", "valveType", "size", "pressureClass"] as const) {
    const t = Date.now();
    const page = await listSalesPage({ ...base, pageSize: 200, extra: { fy, group } }, noCost);
    console.log(group, Date.now() - t, "ms", JSON.stringify({ groups: page.total, kpi: page.meta!.kpi, top: page.rows[0]?.key }));
    assert.equal(page.meta!.kpi.lines, old.length);
    assert.equal(page.meta!.all.total.lines, old.length);
    const expected = new Map<string, { lines: number; sales: number }>();
    for (const l of old) {
      const e = expected.get(l[group]) ?? { lines: 0, sales: 0 };
      e.lines++;
      e.sales += l.value;
      expected.set(l[group], e);
    }
    assert.equal(page.total, expected.size, group);
    for (const r of page.rows) {
      assert.equal(r.total.lines, expected.get(r.key)?.lines, `${group} ${r.key}`);
      assert.ok(Math.abs(r.total.sales - expected.get(r.key)!.sales) < 0.01, `${group} ${r.key}`);
    }
  }
  const page = await listSalesPage({ ...base, extra: { fy } }, noCost);
  for (const m of fiscalMonths(fy)) assert.equal(page.meta!.all.byMonth[m]?.lines ?? 0, old.filter((l) => l.month === m).length, m);
  assert.equal(page.meta!.kpi.undated, old.filter((l) => !l.month).length);

  const facet = await listSalesFacet("valveType", { ...base, extra: { fy } });
  // Postgres orders by its collation; compare the sets.
  assert.deepEqual([...facet].sort(), [...new Set(old.map((l) => l.valveType))].sort());
});
