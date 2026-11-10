import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { fillMergedDown } from "../schedular_function/docket-attachments.js";

test("merged description is copied down to every row of the block", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["DESCRIPTION", "QTY"],
    ["SLUICE VALVE", 3],
    [null, 8],
    [null, 6],
  ]);
  ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
  fillMergedDown(XLSX, ws);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  assert.deepEqual(rows.map((r) => r[0]), ["DESCRIPTION", "SLUICE VALVE", "SLUICE VALVE", "SLUICE VALVE"]);
});
