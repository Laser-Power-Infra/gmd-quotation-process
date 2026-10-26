import { test } from "node:test";
import assert from "node:assert/strict";
import type { GMDUpdateRow } from "../lib/gmdUpdateSlice";
import {
  applyCastingCost,
  computeCardStats,
  computeDuplicateDerivedIds,
  itemToRow,
  matchesNewItemsTableFilters,
} from "../lib/gmd_lib/rawMaterialView";

const item = (o: Partial<GMDUpdateRow>): GMDUpdateRow =>
  ({
    id: "x",
    erpItemCode: "",
    itemNameDerived: "",
    newItemStatus: "",
    cBatch: "",
    ...o,
  }) as GMDUpdateRow;

const RATES = { DI: "100", CS: "", CI: "", SS: "", Bronze: "", MS: "", GI: "" };

test("itemToRow is cached per item identity and inserts derived name + cBatch", () => {
  const a = item({ id: "a", erpItemCode: "E1", itemNameDerived: "NAME", cBatch: "C" });
  const row = itemToRow(a);
  assert.equal(itemToRow(a), row);
  assert.equal(row[2], "NAME");
  assert.equal(row[row.length - 1], "C");
  assert.notEqual(itemToRow({ ...a }), row);
});

test("applyCastingCost keeps identity while the cost is unchanged", () => {
  const a = item({ id: "a", l8ItemCategory: "CASTING", l5Material: "DUCTILE IRON", pcsWgt: "2.5" });
  const b = item({ id: "b", l8ItemCategory: "OTHER", l5Material: "X" });
  const r1 = applyCastingCost([a, b], RATES);
  const r2 = applyCastingCost([a, b], RATES);
  assert.equal(r1.items[0].cost, 250);
  assert.equal(r1.items[0], r2.items[0]);
  assert.equal(r1.items[1], b);
  assert.deepEqual([...r1.lockedIds], ["a"]);
  const r3 = applyCastingCost([a], { ...RATES, DI: "200" });
  assert.equal(r3.items[0].cost, 500);
});

test("duplicates ignore blanks and closed statuses", () => {
  const ids = computeDuplicateDerivedIds([
    item({ id: "1", itemNameDerived: "Foo" }),
    item({ id: "2", itemNameDerived: " foo " }),
    item({ id: "3", itemNameDerived: "foo", newItemStatus: "CLOSED" }),
    item({ id: "4", itemNameDerived: "" }),
    item({ id: "5", itemNameDerived: "" }),
  ]);
  assert.deepEqual([...ids].sort(), ["1", "2"]);
});

test("table filters: global search, column, multi, blank", () => {
  const hdrs = ["A", "B"];
  const row = ["Hello", ""];
  assert.ok(matchesNewItemsTableFilters(row, hdrs, {}, {}, "hell"));
  assert.ok(!matchesNewItemsTableFilters(row, hdrs, {}, {}, "zzz"));
  assert.ok(matchesNewItemsTableFilters(row, hdrs, { B: "(Blank)" }, {}, ""));
  assert.ok(!matchesNewItemsTableFilters(row, hdrs, {}, { A: ["x"] }, ""));
  assert.ok(matchesNewItemsTableFilters(row, hdrs, {}, { B: ["(Blank)"] }, ""));
});

test("card stats cascade on the opposite toggle", () => {
  const hdrs = ["INDIAN/IMPORTED", "MAJOR MARKING"];
  const mk = (imp: string, major: string) => {
    const r: unknown[] = new Array(25).fill("");
    r[0] = imp;
    r[1] = major;
    r[12] = "2";
    r[16] = "10";
    return r;
  };
  // Indices 24/20 fallbacks are unused because headers resolve the columns.
  const rows = [mk("Indian", "TRUE"), mk("Imported", "FALSE"), mk("Indian", "FALSE")];
  const all = computeCardStats(rows, hdrs, "all", "all");
  assert.deepEqual(all.indian, { count: 2, sum: 40 });
  assert.deepEqual(all.minor, { count: 2, sum: 40 });
  const indianOnly = computeCardStats(rows, hdrs, "indian", "all");
  assert.deepEqual(indianOnly.major, { count: 1, sum: 20 });
  assert.deepEqual(indianOnly.indian, { count: 2, sum: 40 });
});
