import test, { mock } from "node:test";
import assert from "node:assert/strict";

// @gmd/db-tender, db-stock and db-quotation reuse globalThis.<name>Prisma, so these fakes stand in for the
// three DBs the real engine reads: two live Contract Review lines, no stock, no ledger, no MC register or BOM rows.
const db = { runs: 0, fail: false };
const live = (id: string) => ({
  id, contractNo: "C1", partyNameDump: "ACME", dateOfContract: "1-Jan-2026", itemCode: `I-${id}`, itemName: "GATE VALVE",
  balBillAgCont: "5", mcReceivedPending: "Received", mcQty: "5", inspection: "PENDING", offerPendingDone: "PENDING",
});
const g = globalThis as unknown as Record<string, unknown>;
g.tenderPrisma = {
  contractReview: {
    findMany: async () => {
      db.runs++;
      if (db.fail) throw new Error("tender DB down");
      return [live("L1"), live("L2")];
    },
  },
};
g.stockPrisma = { physicalStock: { findMany: async () => [] }, stockAllocation: { findMany: async () => [] }, purchaseAllocation: { findMany: async () => [] }, purchaseOrderLine: { findMany: async () => [] } };
g.quotationPrisma = { mcRegisterLine: { findMany: async () => [] }, bomItem: { findMany: async () => [] } };
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-20T06:00:00Z") });

const host = () => import("../lib/contractReviewView.js");

test("one engine run serves Contract Review pages for 30 s; each page gets only its own lines", async () => {
  const { contractReviewAllocation } = await host();
  const first = await contractReviewAllocation(["L1", "not-live"]);
  assert.deepEqual([...first.keys()], ["L1"]);
  assert.equal(first.get("L1")?.status, "Not available");
  assert.deepEqual([...(await contractReviewAllocation(["L2"])).keys()], ["L2"]);
  assert.equal(db.runs, 1);
  mock.timers.tick(30_000);
  await contractReviewAllocation(["L1"]);
  assert.equal(db.runs, 2);
});

test("invalidating the cache makes the next page load run the engine again", async () => {
  const { contractReviewAllocation, invalidateContractReviewAllocation } = await host();
  mock.timers.tick(30_000);
  await contractReviewAllocation(["L1"]);
  const before = db.runs;
  await contractReviewAllocation(["L1"]);
  assert.equal(db.runs, before);
  invalidateContractReviewAllocation();
  await contractReviewAllocation(["L1"]);
  assert.equal(db.runs, before + 1);
});

test("every Stock Allocation write and every allocation-affecting Contract Review save clears the cache", async () => {
  const { readFileSync } = await import("node:fs");
  const sa = readFileSync(new URL("../app/stock_allocation/actions.ts", import.meta.url), "utf8");
  // run() clears it inside its write branch, which all write actions go through.
  assert.match(sa, /if \(write\) \{[^}]*invalidateContractReviewAllocation\(\);[^}]*\}/);
  const cr = readFileSync(new URL("../app/contract_review/actions.ts", import.meta.url), "utf8");
  for (const name of ["updateContractReviewFieldAction", "backfillContractReviewOfferPendingDoneBatchAction", "backfillContractReviewInspectionBatchAction", "backfillContractReviewClearanceMcPendingBatchAction"]) {
    const body = cr.split(`export async function ${name}`)[1].split("\nexport ")[0];
    assert.match(body, /invalidateContractReviewAllocation\(\)/, name);
    assert.match(body, /await requireAccess\(\)/, name);
  }
});

test("a failed engine run leaves the cells blank and is retried on the next page load", async () => {
  const { contractReviewAllocation } = await host();
  mock.timers.tick(30_000);
  const before = db.runs;
  const logged = mock.method(console, "error", () => {});
  db.fail = true;
  try {
    assert.equal((await contractReviewAllocation(["L1"])).size, 0);
    assert.ok(logged.mock.callCount() >= 1);
  } finally {
    db.fail = false;
    logged.mock.restore();
  }
  assert.equal((await contractReviewAllocation(["L1"])).size, 1);
  assert.equal(db.runs - before, 2);
});
