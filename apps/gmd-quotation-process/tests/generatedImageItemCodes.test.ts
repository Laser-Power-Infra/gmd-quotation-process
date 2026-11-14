import { test } from "node:test";
import assert from "node:assert/strict";
import { groupItemCodesByImageKey } from "../lib/generatedImageItemCodes";
import { makeImageKey } from "../lib/imageKey";

test("groups distinct sorted item codes per image key", () => {
  const row = (itemType: string | null, operationType: string | null, rmType: string | null, erpItemCode: string | null) => ({
    itemType, operationType, rmType, erpItemCode,
  });
  const map = groupItemCodesByImageKey([
    row("Gate Valve", "MANUAL", "COMMON", "B2"),
    row(" gate  valve ", "manual", "common", "A1"), // same key after normalising
    row("Gate Valve", "MANUAL", "COMMON", "B2"), // duplicate code
    row("Gate Valve", "MANUAL", "ANSI", "C3"), // different rmType -> different key
    row("Gate Valve", "MANUAL", null, "D4"), // blank rmType
    row("Gate Valve", "MANUAL", "COMMON", null), // no code
    row(null, "MANUAL", "COMMON", "E5"), // no item type
  ]);
  assert.deepEqual(map.get(makeImageKey("Gate Valve", "MANUAL", "COMMON")), ["A1", "B2"]);
  assert.deepEqual(map.get(makeImageKey("Gate Valve", "MANUAL", "ANSI")), ["C3"]);
  assert.deepEqual(map.get(makeImageKey("Gate Valve", "MANUAL", "")), ["D4"]);
  assert.equal(map.size, 3);
});
