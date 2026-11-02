import test from "node:test";
import assert from "node:assert/strict";
import { liveContractsWithoutDocket, type CrRow } from "../lib/contractsWithoutDocket";

const row = (contractNo: string, status: string | null, orderQty = "10"): CrRow => ({
  contractNo, status, partyNameDump: "P", dateOfContract: "01/01/2026", itemCode: "X", item: "Valve", size: "50", orderQty, offerNumber: [],
});

test("live, undocketed contracts only; qty summed across lines", () => {
  const out = liveContractsWithoutDocket(
    [row("A1", null), row("A1", "", "5"), row("B2", "CLOSED"), row("C3", null), row("D4", "CLOSED"), row("D4", null)],
    [" c3 "],
  );
  assert.deepEqual(out.map((c) => c.contractNo), ["A1", "D4"]);
  assert.equal(out[0].qty, 15);
});
