import test from "node:test";
import assert from "node:assert/strict";
import {
  buildYearMap,
  planYearBackfill,
  yearKey,
} from "../lib/supplyFiscalYearBackfill.js";

const HEADERS = ["VRNO", "ITEM_CODE", "VRDATE", "ACC_YEAR", "QTYISSUED"];

test("yearKey normalises both halves and keeps no whitespace", () => {
  assert.equal(yearKey(" gd26y-00028 ", " fum010036 "), "GD26Y-00028||FUM010036");
});

test("the year map takes the first parseable ACC_YEAR per invoice and item code", () => {
  const map = buildYearMap(HEADERS, [
    ["GD26Y-00028", "FUM010036", "12-04-2025", "26-27", "1"],
    ["GD26Y-00028", "FUM010036", "13-04-2025", "2025-26", "2"],
    ["GD26Y-00029", "", "14-04-2025", "26-27", "3"],
    ["GD26Y-00030", "ABC", "", "", "4"],
    ["GD26Y-00031", "DEF", "N.A.", "banana", "5"],
    ["GD26Y-00032", "GHI", "2025-04-15", "2026-2027", "6"],
  ]);

  assert.equal(map.sheetRows, 6);
  assert.equal(map.years.size, 2);
  // Normalised to the four-digit form the engine writes.
  assert.equal(map.years.get(yearKey("GD26Y-00028", "FUM010036")), "2026-27");
  assert.equal(map.years.get(yearKey("GD26Y-00032", "GHI")), "2026-27");
  assert.equal(map.skippedNoCode, 1);
  assert.equal(map.skippedBlankYear, 1);
  assert.equal(map.skippedUnparseableYear, 1);
});

test("a missing key column fails loudly instead of writing nothing", () => {
  assert.throws(
    () => buildYearMap(["VRNO", "ITEMCODE", "ACC_YEAR"], []),
    /missing required column\(s\): ITEM_CODE/,
  );
});

test("a missing ACC_YEAR fails loudly too — it is the whole point of the run", () => {
  assert.throws(
    () => buildYearMap(["VRNO", "ITEM_CODE", "VRDATE"], []),
    /no fiscal-year column/,
  );
});

test("blank fiscal years are filled from the matching invoice and item code", () => {
  const plan = planYearBackfill(
    [
      { id: "a", invoiceNo: "A", erpItemCode: "X", financialYear: null },
      { id: "b", invoiceNo: "B", erpItemCode: "Y", financialYear: "" },
      { id: "nomatch", invoiceNo: "D", erpItemCode: "W", financialYear: null },
      { id: "nocode", invoiceNo: "E", erpItemCode: null, financialYear: null },
    ],
    new Map([
      ["A||X", "2026-27"],
      ["B||Y", "2025-26"],
    ]),
  );

  assert.deepEqual(plan.updates, [
    { id: "a", financialYear: "2026-27" },
    { id: "b", financialYear: "2025-26" },
  ]);
  assert.equal(plan.filled, 2);
  assert.equal(plan.unmatched, 1);
  assert.equal(plan.skippedNoCode, 1);
  assert.equal(plan.rowsScanned, 4);
});

test("an existing fiscal year is never overwritten, not even a differently-spelled one", () => {
  // The query already excludes these rows; the planner must not resurrect them.
  const plan = planYearBackfill(
    [{ id: "a", invoiceNo: "A", erpItemCode: "X", financialYear: "26-27" }],
    new Map([["A||X", "2026-27"]]),
  );
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.filled, 0);
});

test("keys are matched case- and whitespace-insensitively, like the sync", () => {
  const plan = planYearBackfill(
    [{ id: "a", invoiceNo: " a ", erpItemCode: "x", financialYear: "" }],
    buildYearMap(HEADERS, [["A ", " X", "12/04/2025", "26-27", "1"]]).years,
  );
  assert.deepEqual(plan.updates, [{ id: "a", financialYear: "2026-27" }]);
});
