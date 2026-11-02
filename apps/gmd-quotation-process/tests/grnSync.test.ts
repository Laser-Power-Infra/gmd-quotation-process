import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGrnRows } from "../lib/grnSync";

const HEADERS = ["MAIN_POST_NAME", "ACC_CODE", "VRNO", "VRDATE", "ITEM_CODE", "PARTYBILLNO", "PARTYBILLDATE", "ORDER_VRNO", "ORDER_SLNO", "QTYRECD", "PUR_VALUE"];

test("mapGrnRows keeps the PO join key and parses qty/value", () => {
  const { records, skipped } = mapGrnRows(HEADERS, [
    HEADERS, // the tab repeats its header
    ["PURCHASE OF RAW MATERIAL", "FMI01", "GH26Y-00010", "27-10-2026", "REC090006", "B-12", "26-10-2026", "PE26Y-00026", "1", "1,000", "79,120"],
    ["", "FLA04", "GH22220-003", "20-02-2023", "RCC010016", "LP22Y-03849", "16-02-2023", "", "", "2", "-"],
    ["", "", "", "", "", "", "", "", "", "", ""],
  ]);
  assert.equal(skipped, 2);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    vrNo: "GH26Y-00010",
    qtyRecd: 1000,
    purValue: 79120,
    mainPostName: "PURCHASE OF RAW MATERIAL",
    accCode: "FMI01",
    vrDate: "27-10-2026",
    itemCode: "REC090006",
    partyBillNo: "B-12",
    partyBillDate: "26-10-2026",
    orderVrNo: "PE26Y-00026",
    orderSlNo: "1",
  });
  // no PO reference and a dash sentinel value: nothing invented
  assert.equal(records[1].orderVrNo, undefined);
  assert.equal(records[1].purValue, null);
});

test("mapGrnRows refuses a tab without the join columns", () => {
  assert.throws(() => mapGrnRows(["VRNO", "QTYRECD"], []), /ORDER_VRNO/);
});
