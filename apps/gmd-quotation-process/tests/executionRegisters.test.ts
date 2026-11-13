import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMcLines, buildProductionLines } from "../lib/executionRegisters";

// Headers as read live on 12 Nov 2026. The MC tab's column A has no header.
const MC = ["", "VRNO", "SLNO", "CONTRACT_VRNO", "INSPO_SO_QTY", "INSPE_SO_QTY", "ITEM_CODE", "BOM_ID", "QTYORDER", "QTYCANCELLED", "BILLED", "RATE", "ACC_CODE", "PARTY_ITEM_NAME", "CONTRACT_SLNO"];
const mcTab = (rows: string[][]) => ({ tabTitle: "MC", headers: MC, rows });

test("buildMcLines: balance = ordered - cancelled - billed, Open while anything is left", () => {
  const { lines, skipped } = buildMcLines(
    mcTab([
      ["", "OD26Y-00052", "1", "S126Y-00040", "5", "4", "FTD040013", "G2-C0003-84", "1,200", "200", "600", "12112.5", "DME02", "GATE VALVE DN100", "1"],
      ["", "OD22Y-00002", "2", "S122Y-00001", "6", "6", "FTD040017", "-", "6", "0", "6", "23120", "DME02", "", "2"],
      MC, // the tab repeats its header
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]),
  );
  assert.equal(skipped, 2);
  assert.deepEqual(lines[0], {
    mcNo: "OD26Y-00052",
    slNo: "1",
    contractNo: "S126Y-00040",
    contractSlNo: "1",
    itemCode: "FTD040013",
    bomId: "G2-C0003-84",
    partyItemName: "GATE VALVE DN100",
    accCode: "DME02",
    orderedQty: 1200,
    cancelledQty: 200,
    billedQty: 600,
    balanceQty: 400,
    inspOfferedQty: 5,
    inspectedQty: 4,
    rate: 12112.5,
    status: "Open",
  });
  // fully billed; blank and dash cells stay null instead of becoming text
  assert.equal(lines[1].balanceQty, 0);
  assert.equal(lines[1].status, "Closed");
  assert.equal(lines[1].bomId, null);
  assert.equal(lines[1].partyItemName, null);
});

test("buildMcLines: float noise does not reopen a line; over-billing closes it", () => {
  const { lines } = buildMcLines(
    mcTab([
      ["", "OD1", "1", "S1", "", "", "X", "", "3.3", "1.1", "2.2", "", "", "", ""],
      ["", "OD1", "2", "S1", "", "", "Y", "", "5", "0", "7", "10", "", "", ""],
      ["", "OD1", "3", "S1", "", "", "Z", "", "4", "", "junk", "", "", "", ""],
    ]),
  );
  assert.deepEqual(
    lines.map((l) => [l.balanceQty, l.status]),
    [
      [0, "Closed"],
      [-2, "Closed"],
      [4, "Open"], // blank cancelled and junk billed count as 0
    ],
  );
  assert.equal(lines[0].rate, null);
  assert.equal(lines[0].inspOfferedQty, null);
});

test("buildMcLines refuses a renamed column and an empty tab, so the table is never wiped", () => {
  assert.throws(() => buildMcLines({ tabTitle: "MC", headers: MC.filter((h) => h !== "BILLED"), rows: [] }), /BILLED/);
  assert.throws(() => buildMcLines(mcTab([MC, ["", "", "", ""]])), /no lines/i);
});

const ORDERS = ["CONTRACT_VRNO", "VRNO", "VRDATE", "ITEM_CODE", "NET_QTYORDER", "BOM_ID"];
const ENTRIES = ["ITEM_CODE", "VRDATE", "ORDER_VRNO", "QTYRECD"];
const orderTab = (rows: string[][]) => ({ tabTitle: "PROD ORDER DUMP", headers: ORDERS, rows });
const entryTab = (rows: string[][]) => ({ tabTitle: "PROD ENTRY DUMP", headers: ENTRIES, rows });

test("buildProductionLines: produced = sum of entries, last entry date, Pending until done", () => {
  const { lines, skipped, unmatchedEntries } = buildProductionLines(
    orderTab([
      ["OD22Y-00048", "P123Y-00001", "01-04-2023", "FPD010001", "10", "G2-C0003-84"],
      ["OD23Y-00042", "P123Y-00057", "25-05-2023", "FVD020003", "2", ""],
      ["OT23Y-00014", "P123Y-00221", "not a date", "FSD040008", "67", ""],
      [], // blank rows sit in the middle of the dump
      ["", "", "", "", "", ""],
    ]),
    entryTab([
      ["FPD010001", "03-01-2024", "P123Y-00001", "4"],
      ["fpd010001 ", "12-02-2024", " p123y-00001", "3"], // keys are compared normalised
      ["FPD010001", "13-01-2024", "P123Y-00001", "1"],
      ["FVD020003", "10-01-2024", "P123Y-00057", "2"],
      ["FVD020003", "11-01-2024", "P999Y-00001", "5"], // no such production order
      ["", "", "", ""],
    ]),
  );
  assert.equal(skipped, 2);
  assert.equal(unmatchedEntries, 1);
  assert.deepEqual(lines[0], {
    prodOrderNo: "P123Y-00001",
    prodOrderDate: "01-Apr-2023",
    mcNo: "OD22Y-00048",
    itemCode: "FPD010001",
    bomId: "G2-C0003-84",
    orderedQty: 10,
    producedQty: 8,
    balanceQty: 2,
    entries: 3,
    lastEntryDate: "12-Feb-2024",
    status: "Pending",
  });
  assert.equal(lines[1].status, "Completed");
  assert.equal(lines[1].balanceQty, 0);
  assert.equal(lines[1].bomId, null);
  assert.deepEqual(
    [lines[2].prodOrderDate, lines[2].producedQty, lines[2].entries, lines[2].lastEntryDate, lines[2].status],
    [null, 0, 0, null, "Pending"],
  );
});

test("buildProductionLines: a repeated order line is merged, so entries are not counted twice", () => {
  const { lines } = buildProductionLines(
    orderTab([
      ["OD1", "P1", "01-04-2023", "ITEM", "3", ""],
      ["OD1", "P1", "01-04-2023", "ITEM", "2", ""],
    ]),
    entryTab([["ITEM", "02-04-2023", "P1", "6"]]),
  );
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].orderedQty, lines[0].producedQty, lines[0].balanceQty, lines[0].status], [5, 6, 0, "Completed"]);
});

test("buildProductionLines refuses a renamed column and an empty order tab", () => {
  assert.throws(() => buildProductionLines(orderTab([]), { tabTitle: "PROD ENTRY DUMP", headers: ["ITEM_CODE", "VRDATE", "ORDER_VRNO"], rows: [] }), /QTYRECD/);
  assert.throws(() => buildProductionLines({ tabTitle: "PROD ORDER DUMP", headers: ORDERS.slice(1), rows: [] }, entryTab([])), /CONTRACT_VRNO/);
  assert.throws(() => buildProductionLines(orderTab([["", "", "", "", "", ""]]), entryTab([])), /no lines/i);
  // An empty entry read would turn every order back to produced 0: refused too.
  assert.throws(() => buildProductionLines(orderTab([["OD1", "P1", "01-04-2023", "ITEM", "3", ""]]), entryTab([["", "", "", ""]])), /PROD ENTRY DUMP.*no lines/i);
});

test("buildProductionLines skips the entry dump's repeated header, so a header-only read is refused too", () => {
  const orders = orderTab([["OD1", "P1", "01-04-2023", "ITEM", "3", ""]]);
  assert.throws(() => buildProductionLines(orders, entryTab([ENTRIES, ["", "", "", ""]])), /PROD ENTRY DUMP.*no lines/i);
  const { lines, unmatchedEntries } = buildProductionLines(orders, entryTab([ENTRIES, ["ITEM", "02-04-2023", "P1", "3"]]));
  assert.deepEqual([unmatchedEntries, lines[0].producedQty, lines[0].entries, lines[0].status], [0, 3, 1, "Completed"]);
});
