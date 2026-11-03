import test from "node:test";
import assert from "node:assert/strict";
import { NO_BOM_FG, PRODUCTION_ITEM, fgMatcher, bomIdsOf, codesOf, isFinishedValve, matchBoms, rmCodesFor, type BomCodeOptionRow, type RmCodeOptionRow } from "../src/codeOptions";

const row = (bomId: string, valveType: string, size: string, pn: string, erpItemCode: string): BomCodeOptionRow => ({
  bomId, valveType, size, pn, bomType: "CREATE BOM", erpItemCode,
});
const bom = [
  row("B1", "Gate Valve", "50", "PN16", "RM1"),
  row("B1", "Gate Valve", "50", "PN16", "RM2"),
  row("B2", "gate valve ", "50", "PN16", "RM2"),
  row("B2", "gate valve ", "50", "PN16", "RM3"),
  row("B3", "Globe Valve", "80", "PN25", "RM9"),
];

test("finished valve detection is case/space-insensitive", () => {
  assert.ok(isFinishedValve(" finished  valves "));
  assert.ok(!isFinishedValve("CASTING"));
  assert.ok(!isFinishedValve(null));
});

test("matchBoms narrows by picked fields only", () => {
  assert.equal(matchBoms(bom, {}).length, 5);
  assert.deepEqual(bomIdsOf(matchBoms(bom, { valveType: "GATE VALVE", size: "50", pn: "pn16" })), ["B1", "B2"]);
  assert.deepEqual(bomIdsOf(matchBoms(bom, { pn: "PN25" })), ["B3"]);
  assert.equal(matchBoms(bom, { size: "999" }).length, 0);
});

test("rmCodesFor narrows to the picked L8 category, all when none", () => {
  const rm: RmCodeOptionRow[] = [
    { erpItemCode: "RM2", itemName: null, l8Category: "Casting" },
    { erpItemCode: "RM1", itemName: null, l8Category: " casting " },
    { erpItemCode: "RM3", itemName: null, l8Category: "PATTERN" },
    { erpItemCode: "RM4", itemName: null, l8Category: null },
  ];
  assert.deepEqual(rmCodesFor(rm, "CASTING"), ["RM1", "RM2"]);
  assert.deepEqual(rmCodesFor(rm, ""), ["RM1", "RM2", "RM3", "RM4"]);
  assert.deepEqual(rmCodesFor(rm, "SCRAP"), []);
});

test("codesOf lists all matched codes, or one BOM's", () => {
  const m = matchBoms(bom, { valveType: "GATE VALVE" });
  assert.deepEqual(codesOf(m), ["RM1", "RM2", "RM3"]);
  assert.deepEqual(codesOf(m, "B2"), ["RM2", "RM3"]);
});

test("the two databases' real spellings compare equal (checked live, 2 Nov 2026)", () => {
  const real = [
    row("B4", "SLUICE VALVE-METAL-RISING", "700", "PN-10/16", "RM4"),
    row("B5", "BUTTERFLY VALVE", "450X300MM", "CLASS-150#", "RM5"),
    row("B6", "SLUICE VALVE-RESILIENT-NON-RISING", "200", "PN-20/25/30", "RM6"),
  ];
  // stock sends "700MM", FullItem stores "700"
  assert.deepEqual(bomIdsOf(matchBoms(real, { size: "700MM" })), ["B4"]);
  // stock "PN-16" is covered by the compound "PN-10/16"; "PN-25" by "PN-20/25/30"
  assert.deepEqual(bomIdsOf(matchBoms(real, { pn: "PN-16" })), ["B4"]);
  assert.deepEqual(bomIdsOf(matchBoms(real, { pn: "PN-25" })), ["B6"]);
  assert.equal(matchBoms(real, { pn: "PN-40" }).length, 0);
  // stock "CLASS 150#" vs FullItem "CLASS-150#"
  assert.deepEqual(bomIdsOf(matchBoms(real, { pn: "CLASS 150#" })), ["B5"]);
  // stock's "SLUICE VALVE" matches both sluice variants; "BUTTERFLY VALVE" stays exact
  assert.deepEqual(bomIdsOf(matchBoms(real, { valveType: "SLUICE VALVE" })), ["B4", "B6"]);
  assert.deepEqual(bomIdsOf(matchBoms(real, { valveType: "BUTTERFLY VALVE" })), ["B5"]);
});

const fgRow = (fgCode: string, itemType: string, moc: string, size: string) => ({ fgCode, bomId: "B-" + fgCode, itemType, moc, size });
const stock = (l2: string, l5: string, dia: string, l8 = "FINISHED VALVES") => ({
  l8_item_category: l8, l2_valve_type: l2, l5_material: l5, dimension: dia,
});

test("fgMatcher: type before first dash, MOC groups, MM stripped, first FG wins", () => {
  const match = fgMatcher([
    fgRow("FG1", "SLUICE VALVE-RESILIENT-NON-RISING", "DUCTILE IRON/CAST IRON", "700"),
    fgRow("FG2", "SLUICE VALVE-METAL-RISING", "DUCTILE IRON/CAST IRON", "700"),
    fgRow("FG3", "GLOBE VALVE", "CAST STEEL/CARBON STEEL", "50"),
  ]);
  assert.deepEqual(match(stock("SLUICE VALVE", "DUCTILE IRON", "700MM")), { fg_item_code: "FG1", production_item: PRODUCTION_ITEM });
  assert.equal(match(stock("sluice valve", "CAST IRON", "700MM")).fg_item_code, "FG1");
  assert.equal(match(stock("GLOBE VALVE", "CARBON STEEL/CAST STEEL", "50MM")).fg_item_code, "FG3");
  assert.equal(match(stock("GLOBE VALVE", "CAST STEEL", "50MM")).fg_item_code, "FG3");
});

test("fgMatcher: NO BOM FG FOUND, non-finished and unsynced stay as specified", () => {
  const match = fgMatcher([fgRow("FG1", "GLOBE VALVE", "CAST IRON", "50")]);
  assert.deepEqual(match(stock("GLOBE VALVE", "MILD STEEL", "50MM")), { fg_item_code: NO_BOM_FG, production_item: null });
  assert.deepEqual(match(stock("GLOBE VALVE", "CAST IRON", "50MM", "TRADING VALVES")), { fg_item_code: null, production_item: null });
  assert.deepEqual(fgMatcher([])(stock("GLOBE VALVE", "CAST IRON", "50MM")), { fg_item_code: null, production_item: null });
});
