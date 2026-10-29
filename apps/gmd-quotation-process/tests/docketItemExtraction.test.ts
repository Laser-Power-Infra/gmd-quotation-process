import test from "node:test";
import assert from "node:assert/strict";
import { applyVerdicts, applyCondensed } from "../schedular_function/docket-item-extraction.js";

const items = [
  { itemName: "Gate Valve DN150", quantity: 2 },
  { itemName: "Test pressure 10", quantity: 10 },
];

test("drops a junk row", () => {
  const r = applyVerdicts(items, [{ index: 1, keep: false }]);
  assert.deepEqual(r, { items: [items[0]], dropped: 1 });
});

test("corrects a quantity but keeps the name", () => {
  const r = applyVerdicts(items, [{ index: 0, keep: true, quantity: 4 }]);
  assert.deepEqual(r.items[0], { itemName: "Gate Valve DN150", quantity: 4 });
});

test("ignores out-of-range index and invalid quantity", () => {
  const r = applyVerdicts(items, [{ index: 9, keep: false }, { index: 0, keep: true, quantity: -3 }]);
  assert.deepEqual(r, { items, dropped: 0 });
});

test("all-drop answer keeps parser items", () => {
  const r = applyVerdicts(items, [{ index: 0, keep: false }, { index: 1, keep: false }]);
  assert.deepEqual(r, { items, dropped: 0 });
});

test("condense swaps in a shorter name, keeps quantity", () => {
  const long = [{ itemName: "AIR VALVE : Providing and fixing in position ... 100 mm dia Air Valve", quantity: 3 }];
  assert.deepEqual(applyCondensed(long, [{ index: 0, itemName: "Air Valve DN100" }]), [
    { itemName: "Air Valve DN100", quantity: 3 },
  ]);
});

test("condense ignores bad index, empty and longer names", () => {
  assert.deepEqual(
    applyCondensed(items, [
      { index: 9, itemName: "x valve" },
      { index: 0, itemName: "" },
      { index: 1, itemName: "Test pressure 10 and a much longer name" },
    ]),
    items,
  );
});
