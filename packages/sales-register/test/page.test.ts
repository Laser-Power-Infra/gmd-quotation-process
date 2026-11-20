import test from "node:test";
import assert from "node:assert/strict";
import type { SaleCostInput } from "../src/server/query";

// @gmd/db-quotation reuses this global when it is set, so no database is touched: each statement gets canned rows.
const LINES = [
  { month: "2025-04", party: "A", valveType: "BFV", size: "100", pressureClass: "PN 10", quantity: "2", value: "1,000", erpItemCode: "X1", date: "05-Apr-25", erpContractNo: "C1", itemName: "Valve" },
  { month: "2025-05", party: "B", valveType: "BFV", size: "100", pressureClass: "PN 10", quantity: "1", value: "3000", erpItemCode: "X2", date: "05-May-25", erpContractNo: null, itemName: "Valve" },
  { month: "", party: "A", valveType: "GV", size: "-", pressureClass: "-", quantity: "1", value: null, erpItemCode: "X1", date: null, erpContractNo: null, itemName: "Valve" },
];
const KPI = { lines: 3, sales: 4000, invoices: 2, parties: 2, undated: 1, syncedAt: new Date("2026-11-18T00:00:00Z") };
(globalThis as unknown as { quotationPrisma: unknown }).quotationPrisma = {
  $queryRaw: async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("AS label")) return [{ label: "Gate Valve" }];
    if (text.includes('AS fy FROM "SupplyHistoryItem"')) return [{ fy: "2025-26" }];
    if (text.includes('AS "undated"')) return [KPI];
    if (text.includes('SELECT l."month"')) return LINES;
    throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
  },
};

test("a page: lines costed by the host, grouped, paged; sort, page, group and view changes reuse the costed lines", async () => {
  const { listSalesPage } = await import("../src/server/query");
  let passes = 0;
  const costOf = async (lines: SaleCostInput[]) => {
    passes++;
    return lines.map((l) => ({ unitCost: l.erpItemCode === "X1" ? 400 : null, quotedUnitCost: null, minVa: 15 }));
  };
  const q = { page: 1, pageSize: 1, sort: null, search: "", filters: {}, extra: { fy: "2025-26" } };

  const first = await listSalesPage(q, costOf);
  assert.equal(first.total, 2);
  assert.deepEqual(first.rows.map((r) => r.key), ["B"]); // biggest sales first, one per page
  const all = first.meta!.all.total;
  assert.equal(all.sales, 4000);
  assert.equal(all.cost, 800); // 2 × 400; X2 has no rate, and the third line has no sales value, so both are cost missing
  assert.equal(all.missingLines, 2);
  assert.equal(first.meta!.all.byMonth["2025-04"].cost, 800);
  assert.deepEqual(first.meta!.years, ["2025-26"]);
  assert.equal(first.meta!.syncedAt, "2026-11-18T00:00:00.000Z");
  assert.deepEqual(first.meta!.kpi, { lines: 3, sales: 4000, invoices: 2, parties: 2, undated: 1 });

  const regrouped = await listSalesPage({ ...q, page: 2, sort: { key: "total", dir: "desc" }, extra: { fy: "2025-26", group: "valveType", view: "gpPct" } }, costOf);
  assert.deepEqual(regrouped.rows.map((r) => r.key), ["GV"]); // BFV (GP 20%) first, GV (cost missing) last
  assert.equal(passes, 1);

  await listSalesPage({ ...q, search: "acme" }, costOf);
  assert.equal(passes, 2); // another line set is costed on its own
  // This year is listed even before it has a line.
  assert.deepEqual((await listSalesPage({ ...q, extra: { fy: "2026-27" } }, costOf)).meta!.years, ["2026-27", "2025-26"]);
});
