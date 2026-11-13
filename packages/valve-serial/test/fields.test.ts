import test from "node:test";
import assert from "node:assert/strict";
import { mpaToBar, needsStandard, normaliseValveSerial, outOfTolerance, pickStandard, toleranceFlags } from "../src/fields";

const flange = [
  { size: "100", moc: "CI", pnRatingClass: "PN - 10", idMm: "", odMm: "220", odTolerancePlus: "+2", odToleranceMinus: "-2", pcdMm: "180", pcdTolerance: "±1", noOfHoleNos: "8", holeDia: "19", thicknessOfFlange: "", standards: "IS 1538", bodyPressure: "15", seatPressure: "11" },
  { size: "100", moc: "DI", pnRatingClass: "PN - 10", odMm: "221", standards: "EN 1092" },
];
const gate = [{ sizeMm: "100", pnRatingClass: "PN10", flangeOdMm: "999", faceToFaceLengthMm: "229", faceToFaceLengthTolerance: "± 2", approxWeightKg: "38", thicknessOfFlange: "x", bodyPressure: "16", seatPressure: "12" }];

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

test("a PN in MPa (the dispatch sheet's \"1.6\") matches the bar rating of Technicals (\"PN - 16\", \"16\")", () => {
  const rows = [{ size: "100", pnRatingClass: "PN - 16", odMm: "220" }, { size: "80", pnRatingClass: "16", odMm: "200" }];
  assert.equal(pickStandard({ sizeDn: "100", pnRating: "1.6" }, rows, []).odMm?.value, "220");
  assert.equal(pickStandard({ sizeDn: "80", pnRating: "1.6" }, rows, []).odMm?.value, "200");
  assert.equal(pickStandard({ sizeDn: "100", pnRating: "1.0" }, flange, gate).odMm?.value, "220");
  assert.deepEqual(["1.6", "1.0", "0.6", "2.5", "16", "Class-150"].map(mpaToBar), ["16", "10", "6", "25", "16", "Class-150"]);
});

test("a knife gate valve gets no Gate Valve standards", () => {
  const std = pickStandard({ valveType: "KNIFE GATE VALVE", sizeDn: "100", pnRating: "PN10" }, flange, gate);
  assert.equal(std.faceToFaceMm, undefined);
  assert.equal(std.weightKg, undefined);
  assert.equal(std.odMm?.source, "Flange");
});

test("the standard snapshot is re-taken when missing or empty, or when type, size or PN change", () => {
  const row = { valveType: "SLUICE VALVE", sizeDn: "100", pnRating: "16", standard: { odMm: { value: "220", plus: 2, minus: 2, source: "Flange" } } };
  assert.equal(needsStandard(null, row), true);
  assert.equal(needsStandard(row, row), false);
  assert.equal(needsStandard({ ...row, standard: {} }, row), true);
  assert.equal(needsStandard({ ...row, standard: null }, row), true);
  assert.equal(needsStandard(row, { ...row, pnRating: "10" }), true);
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

test("test pressures pre-fill from the Flange row, else the Gate Valve row, and are never flagged", () => {
  const std = pickStandard({ valveType: "Sluice Valve", sizeDn: "100", pnRating: "PN10" }, flange, gate);
  assert.deepEqual([std.bodyTestPressure?.value, std.seatTestPressure?.value, std.bodyTestPressure?.source], ["15", "11", "Flange"]);
  // The DI Flange row has no pressures: the Gate Valve row fills them.
  const di = pickStandard({ valveType: "Sluice Valve", sizeDn: "100", pnRating: "PN10", bodyMoc: "DI" }, flange, gate);
  assert.deepEqual([di.bodyTestPressure?.value, di.seatTestPressure?.value, di.seatTestPressure?.source], ["16", "12", "Gate Valve"]);
  assert.equal(outOfTolerance("99", std.bodyTestPressure), false);
});

test("test and dispatch fields are trimmed and kept", () => {
  const r = normaliseValveSerial({ serialNo: "RSLV-40-00001", testResult: " Pass ", invoiceNo: " GD25Y-00221 ", tcLink: " " });
  assert.ok("data" in r);
  assert.equal(r.data.testResult, "Pass");
  assert.equal(r.data.invoiceNo, "GD25Y-00221");
  assert.equal(r.data.tcLink, null);
  assert.equal(r.data.gearboxSerial, null);
});
