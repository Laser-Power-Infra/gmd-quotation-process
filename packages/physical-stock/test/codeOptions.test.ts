import test from "node:test";
import assert from "node:assert/strict";
import { bomIdsOf, codesOf, isFinishedValve, matchBoms, type BomCodeOptionRow } from "../src/codeOptions";

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

test("codesOf lists all matched codes, or one BOM's", () => {
  const m = matchBoms(bom, { valveType: "GATE VALVE" });
  assert.deepEqual(codesOf(m), ["RM1", "RM2", "RM3"]);
  assert.deepEqual(codesOf(m, "B2"), ["RM2", "RM3"]);
});
