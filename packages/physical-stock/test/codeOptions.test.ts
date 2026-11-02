import test from "node:test";
import assert from "node:assert/strict";
import { bomIdsOf, codesOf, isFinishedValve, matchBoms, rmCodesFor, type BomCodeOptionRow, type RmCodeOptionRow } from "../src/codeOptions";

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
