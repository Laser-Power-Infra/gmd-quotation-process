import test from "node:test";
import assert from "node:assert/strict";
import { flattenCreateBoms, isCreateBom } from "../lib/physicalStockCodeOptions";

const fi = { itemType: " Gate Valve ", size: "50", pnGmd: "PN16" };
const comp = (c: string | null) => ({ rawMaterial: c === null ? null : { erpItemCode: c } });

test("isCreateBom tolerates spelling variants", () => {
  assert.ok(isCreateBom("CREATE BOM"));
  assert.ok(isCreateBom("create_bom"));
  assert.ok(!isCreateBom("2:1"));
  assert.ok(!isCreateBom(null));
});

test("flattenCreateBoms keeps only CREATE BOMs, distinct RM codes", () => {
  const rows = flattenCreateBoms([
    { bomId: "B1", bomIdType: "CREATE BOM", fullItem: fi, components: [comp("RM1"), comp("RM1"), comp(" "), comp(null), comp("RM2")] },
    { bomId: "B2", bomIdType: "2:1", fullItem: fi, components: [comp("RM9")] },
  ]);
  assert.deepEqual(rows.map((r) => [r.bomId, r.erpItemCode]), [["B1", "RM1"], ["B1", "RM2"]]);
  assert.deepEqual([rows[0].valveType, rows[0].size, rows[0].pn], ["Gate Valve", "50", "PN16"]);
});
