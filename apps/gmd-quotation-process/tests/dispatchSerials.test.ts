import test from "node:test";
import assert from "node:assert/strict";
import { DISPATCH_TABS, isoDate, mergeBySerial, parseDispatchTab, planImport, type DispatchRecord } from "../lib/dispatchSerials.js";

const master = DISPATCH_TABS.find((t) => t.gid === 0)!;
const prv = DISPATCH_TABS.find((t) => t.gid === 1781187734)!;
const MASTER_HEADERS = ["CONTRACT NO", "PARTY NAME", "ITEM CODE", "ITEM NAME", "ITEM", "SIZE(MM)", "ACTUATOR- MODEL NO", "ACTUATOR-SR NO", "SL NO - VALVE", "DATE OF INVOICE", "INVOICE NO", "HEAT NO", "OTHER REMARKS", "GEAR BOX-SR NO", "GEAR- MODEL NO"];

test("master tab: columns by header name, invoice date to ISO, rows without a valve serial set aside", () => {
  const { records, noSerial } = parseDispatchTab(master, {
    tabTitle: "master sheet dispatch",
    headers: MASTER_HEADERS,
    rows: [
      ["OGKR- I", "KALPATARU PROJECTS", "", "", "SLUICE VALVE", "200", "K300-48RPM", "3B253907 02", " 14868 ", "8-Dec-2025", "GD25Y-00264", "2502", "1692Z60F"],
      ["NUPRO", "NUPRO ENGINEERING", "", "", "ACTUATOR ", "-", "K150 - 24 RPM", "3B202714 09", "", "29-11-2025", "GD25Y-00249"],
      [],
    ],
  });
  assert.deepEqual(records, [
    {
      contractNo: "OGKR- I",
      partyName: "KALPATARU PROJECTS",
      valveType: "SLUICE VALVE",
      sizeDn: "200",
      actuatorModel: "K300-48RPM",
      actuatorSerial: "3B253907 02",
      serialNo: "14868",
      invoiceDate: "2025-12-08",
      invoiceNo: "GD25Y-00264",
      heatNo: "2502",
      remarks: "1692Z60F",
    },
  ]);
  assert.equal(noSerial.length, 1);
  assert.equal(noSerial[0][7], "3B202714 09");
});

test("type tab: header is the first non-blank row, rows carry the tab's valve type, a renamed column fails loudly", () => {
  const read = {
    tabTitle: "PRV",
    headers: [],
    rows: [
      ["ITEM_CODE", "size", "ITEM_NAME", "VRNO", "UM", "SALE QTY", "sl no", "HEAT NO"],
      ["FCF080062", "100", "Pressure Reducing Valve", "GD24Y-00212", "PCS", "1", "PRV-100-0001", ""],
    ],
  };
  assert.deepEqual(parseDispatchTab(prv, read).records, [
    { valveType: "PRV", itemCode: "FCF080062", sizeDn: "100", itemName: "Pressure Reducing Valve", invoiceNo: "GD24Y-00212", serialNo: "PRV-100-0001" },
  ]);
  const renamed = { ...read, rows: [["ITEM CODE", "size", "ITEM NAME", "INVOICE", "sl no", "HEAT NO"]] };
  assert.throws(() => parseDispatchTab(prv, renamed), /"PRV" is missing required column\(s\): VRNO/);
});

test("knife gate tab: PN in MPa becomes bar, the unheaded column I is the remarks, a header over it fails loudly", () => {
  const knife = DISPATCH_TABS.find((t) => t.gid === 1527881089)!;
  // As the sheet has it (12 Nov 2026): eight headers, "PN RATING " with a trailing space, remarks in column I.
  const headers = ["ITEM CODE", "ITEM_NAME", "SIZE", "PN RATING ", "UM", "SI.NO", "INVOICE NO", "HEAT NO"];
  const read = {
    tabTitle: "KNIFE GATE VALVE ",
    headers,
    rows: [
      ["", "Knife gate Valve", "80", "0.6", "PCS", "KGV-80-00001", "", "", "SENT FOR EXHIBITION"],
      ["", "Knife gate Valve", "100", "1.6", "PCS", "KGV-100-00002"],
    ],
  };
  assert.deepEqual(parseDispatchTab(knife, read).records, [
    { valveType: "KNIFE GATE VALVE", itemName: "Knife gate Valve", sizeDn: "80", pnRating: "6", serialNo: "KGV-80-00001", remarks: "SENT FOR EXHIBITION" },
    { valveType: "KNIFE GATE VALVE", itemName: "Knife gate Valve", sizeDn: "100", pnRating: "16", serialNo: "KGV-100-00002" },
  ]);
  assert.throws(() => parseDispatchTab(knife, { ...read, headers: [...headers, "QTY"] }), /header "QTY" over the unheaded remarks column/);
  // Other tabs keep the sheet's text in column I out of the import.
  const sluice = DISPATCH_TABS.find((t) => t.gid === 1960097486)!;
  const sl = parseDispatchTab(sluice, {
    tabTitle: "SLUICE VALVE",
    headers: ["ITEM CODE", "ITEM NAME", "SIZE IN MM", "PN RATING ", "QUANTITY (PCS)", "INVOICE NO", "SL.NO", "HEAT NO"],
    rows: [["", "Sluice Valve", "40", "Class-150", "1", "", "RSLV-40-00001", "", "DISPATCH"]],
  });
  assert.deepEqual(sl.records, [{ valveType: "SLUICE VALVE", itemName: "Sluice Valve", sizeDn: "40", pnRating: "Class-150", serialNo: "RSLV-40-00001" }]);
});

test("isoDate: d-MMM-yyyy and dd-mm-yyyy become ISO; anything else stays as typed", () => {
  assert.equal(isoDate("3-Dec-2025"), "2025-12-03");
  assert.equal(isoDate("29-11-2025"), "2025-11-29");
  assert.equal(isoDate("31-02-2025"), "31-02-2025");
  assert.equal(isoDate("27-Feb-25"), "27-Feb-25");
});

test("merge by serial: the first row wins, later rows fill its blanks, differing values are conflicts", () => {
  const { bySerial, conflicts } = mergeBySerial([
    {
      source: "master sheet dispatch",
      records: [
        { serialNo: "15727", invoiceNo: "GD25Y-00285", actuatorSerial: "3B20272209", valveType: "Sluice Valve" },
        { serialNo: "15727", invoiceNo: "GD25Y-00285", actuatorSerial: "3B20272210" },
      ],
    },
    { source: "SLUICE VALVE", records: [{ serialNo: "15727", valveType: "SLUICE  VALVE", heatNo: "2503" }, { serialNo: "RSLV-40-00001", valveType: "SLUICE VALVE" }] },
  ]);
  assert.equal(bySerial.size, 2);
  assert.deepEqual(bySerial.get("15727"), { serialNo: "15727", invoiceNo: "GD25Y-00285", actuatorSerial: "3B20272209", valveType: "Sluice Valve", heatNo: "2503" });
  assert.deepEqual(conflicts, [{ serialNo: "15727", field: "actuatorSerial", kept: "3B20272209", ignored: "3B20272210", where: "master sheet dispatch" }]);
});

test("plan: new serials are created; existing rows only get their blanks filled, conflicts keep the database value", () => {
  const sheet = new Map<string, DispatchRecord>([
    ["A1", { serialNo: "A1", partyName: "NCC LIMITED", invoiceNo: "GD25Y-00257", valveType: "Butterfly Valve" }],
    ["B2", { serialNo: "B2", invoiceNo: "GD25Y-00258" }],
  ]);
  const plan = planImport(sheet, [{ serialNo: "A1", partyName: "NCC LTD", invoiceNo: null, valveType: "BUTTERFLY VALVE", odMm: "220" }]);
  assert.deepEqual(plan.creates, [{ serialNo: "B2", invoiceNo: "GD25Y-00258" }]);
  assert.deepEqual(plan.updates, [{ serialNo: "A1", data: { invoiceNo: "GD25Y-00257" } }]);
  assert.deepEqual(plan.conflicts, [{ serialNo: "A1", field: "partyName", kept: "NCC LTD", ignored: "NCC LIMITED", where: "database" }]);
});

test("every tab maps a valve serial column, and the master tab carries the dispatch columns", () => {
  assert.equal(DISPATCH_TABS.length, 8);
  assert.ok(DISPATCH_TABS.every((t) => t.columns.serialNo));
  assert.ok(DISPATCH_TABS.slice(1).every((t) => t.valveType && t.columns.invoiceNo));
  assert.deepEqual(Object.values(master.columns).sort(), [...MASTER_HEADERS].sort());
});
