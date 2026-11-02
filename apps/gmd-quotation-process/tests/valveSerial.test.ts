import test from "node:test";
import assert from "node:assert/strict";
import { normaliseValveSerial, outOfTolerance, pickStandard, toleranceFlags } from "../lib/valveSerial.js";

const flange = [
  { size: "100", moc: "CI", pnRatingClass: "PN - 10", idMm: "", odMm: "220", odTolerancePlus: "+2", odToleranceMinus: "-2", pcdMm: "180", pcdTolerance: "±1", noOfHoleNos: "8", holeDia: "19", thicknessOfFlange: "", standards: "IS 1538" },
  { size: "100", moc: "DI", pnRatingClass: "PN - 10", odMm: "221", standards: "EN 1092" },
];
const gate = [{ sizeMm: "100", pnRatingClass: "PN10", flangeOdMm: "999", faceToFaceLengthMm: "229", faceToFaceLengthTolerance: "± 2", approxWeightKg: "38", thicknessOfFlange: "x" }];

test("Flange tab wins; Gate Valve fills only what Flange lacks, and only for gate/sluice valves", () => {
  const std = pickStandard({ valveType: "Sluice Valve", sizeDn: "DN 100", pnRating: "PN10" }, flange, gate);
  assert.equal(std.odMm?.value, "220");
  assert.equal(std.odMm?.source, "Flange");
  assert.deepEqual([std.pcdMm?.plus, std.pcdMm?.minus], [1, 1]);
  assert.equal(std.faceToFaceMm?.value, "229");
  assert.equal(std.faceToFaceMm?.plus, 2);
  assert.equal(std.weightKg?.source, "Gate Valve");
  assert.equal(std.idMm, undefined); // blank cell is not a standard
  const bfv = pickStandard({ valveType: "Butterfly Valve", sizeDn: "100", pnRating: "10" }, flange, gate);
  assert.equal(bfv.faceToFaceMm, undefined);
  assert.equal(bfv.odMm?.value, "220");
});

test("body MOC picks the matching Flange row; no size or PN means no standard", () => {
  assert.equal(pickStandard({ sizeDn: "100", pnRating: "PN 10", bodyMoc: "di" }, flange, gate).odMm?.value, "221");
  assert.deepEqual(pickStandard({ sizeDn: "", pnRating: "PN10" }, flange, gate), {});
  assert.deepEqual(pickStandard({ sizeDn: "100", pnRating: "PN16" }, flange, gate), {});
});

test("out-of-tolerance flags only numbers outside the band", () => {
  const std = { value: "220", plus: 2, minus: 2, source: "Flange" as const };
  assert.equal(outOfTolerance("222", std), false);
  assert.equal(outOfTolerance("217.9", std), true);
  assert.equal(outOfTolerance("", std), false);
  assert.equal(outOfTolerance("300", { ...std, plus: null, minus: null }), false);
  const s = pickStandard({ sizeDn: "100", pnRating: "PN10" }, flange, gate);
  assert.deepEqual(toleranceFlags({ odMm: "230", boltHoles: "4", pcdMm: "180.5" }, s), ["odMm", "boltHoles"]);
});

test("serial no is required and fields are trimmed", () => {
  assert.deepEqual(normaliseValveSerial({ serialNo: "  " }), { error: "Serial No is required." });
  const r = normaliseValveSerial({ serialNo: " GV-001 ", odMm: " 220 " });
  assert.ok("data" in r && r.data.serialNo === "GV-001" && r.data.odMm === "220" && r.data.idMm === null);
});
