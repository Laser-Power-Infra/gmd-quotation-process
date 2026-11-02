import test from "node:test";
import assert from "node:assert/strict";
import { outOfTolerance, pickFlange, standardFromFlange } from "../src/dimensions";

const flange = { size: "DN100", pnRatingClass: "PN 16", moc: "CI", odMm: "220", odTolerancePlus: "1", odToleranceMinus: "-1", pcdMm: "180", pcdTolerance: "±0.5", holeDia: "18", holeDiaTolerancePlus: "0.5", holeDiaToleranceMinus: "0" };

test("pickFlange matches size + PN digits, MOC breaks ties", () => {
  const other = { ...flange, moc: "DI" };
  assert.equal(pickFlange([other, flange], { dimension: "100", l7_dimension: "PN16", l5_material: "ci" }), flange);
  assert.equal(pickFlange([flange], { dimension: "150", l7_dimension: "PN16" }), null);
});

test("standard pre-fill and tolerance flags", () => {
  const std = standardFromFlange(flange);
  assert.equal(std.values.od, "220");
  assert.deepEqual(outOfTolerance({ od: "221", pcd: "180.4", hole_dia: "18.5" }, std), []);
  assert.deepEqual(outOfTolerance({ od: "222", pcd: "181", hole_dia: "17.9", id_mm: "5" }, std), ["od", "pcd", "hole_dia"]);
});
