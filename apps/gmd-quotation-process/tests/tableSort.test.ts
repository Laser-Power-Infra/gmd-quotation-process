import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "@gmd/dashboard/lib/tableSort";
import { nextSort } from "@gmd/ui/components/plain-table";

type R = { id: number; v: unknown };
const rows = (...vs: unknown[]): R[] => vs.map((v, id) => ({ id, v }));
const by = (r: R) => r.v;
const asc = { key: "v", dir: "asc" } as const;
const desc = { key: "v", dir: "desc" } as const;

test("no sort returns the rows as they came", () => {
  const rs = rows(3, 1, 2);
  assert.equal(sortRows(rs, null, by), rs);
});

test("numbers sort as numbers, not text", () => {
  const rs = rows(9, 10, 2);
  assert.deepEqual(sortRows(rs, asc, by).map(by), [2, 9, 10]);
  assert.deepEqual(sortRows(rs, desc, by).map(by), [10, 9, 2]);
});

test("text sorts case-insensitively in natural order", () => {
  assert.deepEqual(sortRows(rows("PN-16", "pn-2", "PN-10"), asc, by).map(by), ["pn-2", "PN-10", "PN-16"]);
});

test("date keys sort by day, not by text", () => {
  const rs = rows("05-Jan-2026", "20-Dec-2025", "01-Mar-2026");
  assert.deepEqual(sortRows(rs, asc, by, ["v"]).map(by), ["20-Dec-2025", "05-Jan-2026", "01-Mar-2026"]);
  assert.deepEqual(sortRows(rs, desc, by, ["v"]).map(by), ["01-Mar-2026", "05-Jan-2026", "20-Dec-2025"]);
});

test("Date values sort by time, not by their text", () => {
  // As text these would order by weekday name: Fri, Thu, Wed.
  const rs = rows(new Date(2026, 0, 2), new Date(2025, 11, 31), new Date(2026, 0, 1));
  assert.deepEqual(sortRows(rs, asc, by).map((r) => r.id), [1, 2, 0]);
  assert.deepEqual(sortRows(rs, desc, by).map((r) => r.id), [0, 2, 1]);
  assert.deepEqual(sortRows(rs, asc, by, ["v"]).map((r) => r.id), [1, 2, 0]);
});

test("blanks sort last in both directions", () => {
  const rs = rows(null, 5, "", 3, undefined);
  assert.deepEqual(sortRows(rs, asc, by).map(by), [3, 5, null, "", undefined]);
  assert.deepEqual(sortRows(rs, desc, by).map(by), [5, 3, null, "", undefined]);
  const ds = rows("", "05-Jan-2026", null, "20-Dec-2025");
  assert.deepEqual(sortRows(ds, desc, by, ["v"]).map(by), ["05-Jan-2026", "20-Dec-2025", "", null]);
});

test("ties keep the incoming order and the input is not changed", () => {
  const rs = rows(1, 0, 1, 0);
  assert.deepEqual(sortRows(rs, asc, by).map((r) => r.id), [1, 3, 0, 2]);
  assert.deepEqual(rs.map((r) => r.id), [0, 1, 2, 3]);
});

test("header clicks cycle ascending, descending, off", () => {
  assert.deepEqual(nextSort(null, "a"), { key: "a", dir: "asc" });
  assert.deepEqual(nextSort({ key: "a", dir: "asc" }, "a"), { key: "a", dir: "desc" });
  assert.equal(nextSort({ key: "a", dir: "desc" }, "a"), null);
  assert.deepEqual(nextSort({ key: "b", dir: "desc" }, "a"), { key: "a", dir: "asc" });
});
