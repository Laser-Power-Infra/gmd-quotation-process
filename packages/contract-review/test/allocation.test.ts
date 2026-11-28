import test from "node:test";
import assert from "node:assert/strict";
import { ALLOCATION_HEADERS, CONTRACT_REVIEW_HEADERS } from "../src/lib/columns";
import { DEFAULT_CONTRACT_REVIEW_FLAGS } from "../src/flags";
import type { ContractReviewViewQuery, StockAllocationLine } from "../src/types";

// @gmd/db-tender reuses globalThis.tenderPrisma, so this fake stands in for the tender DB: the
// page's row query gets `db.rows`, the totals query one count row, every other query nothing.
const db = { rows: [{ id: "a", itemCode: "X" }, { id: "b", itemCode: "Y" }] };
(globalThis as unknown as { tenderPrisma: unknown }).tenderPrisma = {
  $queryRaw: async ({ sql }: { sql: string }) =>
    sql.startsWith("SELECT c.*")
      ? db.rows
      : sql.includes(" AS total,")
        ? [{ total: db.rows.length, matched: db.rows.length, contracts: 0, synced_at: null }]
        : [],
};
const server = () => import("../src/server/query");

const flags = DEFAULT_CONTRACT_REVIEW_FLAGS;
const q = {} as ContractReviewViewQuery;
const blank = ALLOCATION_HEADERS.map(() => "");
const tail = (row: unknown[]) => row.slice(CONTRACT_REVIEW_HEADERS.length);
const at = (cells: string[], header: (typeof ALLOCATION_HEADERS)[number]) => cells[ALLOCATION_HEADERS.indexOf(header)];
const line = (over: Partial<StockAllocationLine> = {}): StockAllocationLine => ({
  balanceToOffer: 5, fgQty: 2, rmRouteQty: 1, incomingQty: 0, eta: null, shortfall: 2, status: "Partial",
  actuatorFree: null, gbFree: null, flags: [], suggestions: [], ...over,
});
const noBomOrImages = { bomIds: async () => new Map<string, string[]>(), images: async () => ({}) };

test("allocation cells: blank for a line the engine does not cover, quantities as text otherwise", async () => {
  const { allocationCells } = await server();
  assert.deepEqual(allocationCells(undefined), blank);
  assert.deepEqual(
    allocationCells(line({ status: "Ready for inspection call", balanceToOffer: 1200, fgQty: 1200, rmRouteQty: 0, shortfall: 0 })),
    ["1,200", "1,200", "0", "0", "0", "", "", "Ready for inspection call", ""],
  );
});

test("allocation cells: the ETA shows only beside an incoming qty above 0", async () => {
  const { allocationCells } = await server();
  const incoming = (incomingQty: number, eta: string | null) => at(allocationCells(line({ incomingQty, eta })), "ALLOC INCOMING");
  assert.equal(incoming(3, "12-Dec-2026"), "3 (ETA 12-Dec-2026)");
  assert.equal(incoming(3, null), "3");
  assert.equal(incoming(0, "12-Dec-2026"), "0");
});

test("allocation cells: wiring change, actuator / gearbox free and the notes under the status", async () => {
  const { allocationCells } = await server();
  const wiring = allocationCells(line({
    status: "Allocated - wiring change required", fgQty: 5, rmRouteQty: 0, shortfall: 0, actuatorFree: 2, gbFree: 0,
    flags: ["allocated - wiring change required", "production entry from 4001"],
  }));
  assert.equal(at(wiring, "ALLOC STATUS"), "Allocated - wiring change required");
  assert.equal(at(wiring, "ACT / GB FREE"), "ACT 2 / GB 0");
  // The status already says it, so the notes do not repeat the wiring flag.
  assert.equal(at(wiring, "ALLOC NOTES"), "production entry from 4001");
  assert.equal(at(allocationCells(line({ actuatorFree: 4 })), "ACT / GB FREE"), "ACT 4");
  // A manual-gearbox line (no actuator) has a gearbox figure but is not actuated: blank.
  assert.equal(at(allocationCells(line({ gbFree: 1 })), "ACT / GB FREE"), "");
  const partial = allocationCells(line({
    flags: ["PN-25 offered against PN-16"],
    suggestions: [{ erpCode: "V-1538", qty: 2, note: "possible after machining" }],
  }));
  assert.equal(at(partial, "ALLOC NOTES"), "PN-25 offered against PN-16 · V-1538: 2 possible after machining");
});

test("allocation cells: ALLOC SOURCE says incoming PO / received -> physical / short, and never lot, invoice, B/L or ETA", async () => {
  const { allocationCells, sourceCell } = await server();
  assert.equal(sourceCell(undefined), "");
  assert.equal(sourceCell([]), "");
  assert.equal(sourceCell([{ poNo: "4500", poLineNo: "10", qty: 20, state: "incoming" }]), "Incoming PO 4500/10");
  assert.equal(sourceCell([{ poNo: "4500", poLineNo: "10", qty: 30, state: "received" }]), "Received -> physical stock");
  assert.equal(sourceCell([{ poNo: "4500", poLineNo: "10", qty: 1200, state: "short" }]), "Short 1,200");
  assert.equal(
    sourceCell([{ poNo: "4500", poLineNo: "10", qty: 30, state: "received" }, { poNo: "4500", poLineNo: "10", qty: 20, state: "incoming" }]),
    "Received -> physical stock; Incoming PO 4500/10",
  );
  // the host passes the engine line whole: extra fields (lot, invoice, B/L, ETA) must not reach the cell
  const rich = { poNo: "4500", poLineNo: "10", qty: 20, state: "incoming", lot: "LOT-7", tinaInvoiceNo: "TI-9", blNo: "BL-3", eta: "12-Dec-2026" };
  const cells = allocationCells(line({ sources: [rich] }));
  assert.equal(at(cells, "ALLOC SOURCE"), "Incoming PO 4500/10");
  assert.equal(cells.filter((c) => /LOT-7|TI-9|BL-3|12-Dec-2026/.test(c)).length, 0);
});

test("allocation cells: a skipped (Blue Star) line shows the engine's reason as its status", async () => {
  const { allocationCells } = await server();
  assert.deepEqual(
    allocationCells(line({ status: "Blue Star - left out for now", fgQty: 0, rmRouteQty: 0, shortfall: 5 })),
    ["5", "0", "0", "0", "5", "", "", "Blue Star - left out for now", ""],
  );
});

test("no allocation lookup (tender app): the columns are absent from the page and the export", async () => {
  const { listContractReviewAllRows, listContractReviewPage } = await server();
  for (const opts of [{ flags }, { flags, lookups: noBomOrImages }]) {
    const page = await listContractReviewPage(q, opts);
    assert.deepEqual(page.headers, [...CONTRACT_REVIEW_HEADERS]);
    assert.equal(page.rows[0].length, CONTRACT_REVIEW_HEADERS.length);
    assert.equal((await listContractReviewAllRows(q, opts))[0].length, CONTRACT_REVIEW_HEADERS.length);
  }
});

test("with the lookup: one call per request, cells per line, blank for an uncovered line, the export too", async () => {
  const { allocationCells, listContractReviewAllRows, listContractReviewPage } = await server();
  const calls: string[][] = [];
  const covered = line();
  const lookups = {
    ...noBomOrImages,
    allocation: async (ids: string[]) => {
      calls.push(ids);
      return new Map([["a", covered]]);
    },
  };
  const page = await listContractReviewPage(q, { flags, lookups });
  assert.deepEqual(calls, [["a", "b"]]);
  assert.deepEqual(page.headers, [...CONTRACT_REVIEW_HEADERS, ...ALLOCATION_HEADERS]);
  assert.deepEqual(tail(page.rows[0]), allocationCells(covered));
  assert.deepEqual(tail(page.rows[1]), blank);
  // The Excel export reads every matching row in the same layout.
  assert.deepEqual((await listContractReviewAllRows(q, { flags, lookups })).map(tail), [allocationCells(covered), blank]);
  assert.equal(calls.length, 2);
});

test("a page with no rows keeps the column headers and does not call the lookup", async () => {
  const { listContractReviewPage } = await server();
  const saved = db.rows;
  db.rows = [];
  try {
    let called = false;
    const allocation = async () => {
      called = true;
      return new Map<string, StockAllocationLine>();
    };
    const page = await listContractReviewPage(q, { flags, lookups: { ...noBomOrImages, allocation } });
    assert.deepEqual(page.headers.slice(CONTRACT_REVIEW_HEADERS.length), [...ALLOCATION_HEADERS]);
    assert.equal(called, false);
  } finally {
    db.rows = saved;
  }
});
