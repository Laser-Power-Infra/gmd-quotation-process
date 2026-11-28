import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { parseActuatorWorkbook, readActuatorWorkbook, SPECS, updateData } from '../lib/actuatorMaster.js'
import { selectActuator } from '../lib/actuatorSelect.js'
import { ALT_ROWS, MASTER, ROTORK_DERATES, RM_CODES, TFW_ROWS } from './actuatorFixture.js'

const sheet = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows)

// Header row from the parser's own spec; each record fills the fields it names.
const tab = (spec: Record<string, [string, string]>, recs: Record<string, unknown>[]) => [
  ['Title'], [], Object.values(spec).map(([h]) => h),
  ...recs.map((r) => Object.keys(spec).map((f) => r[f] ?? null)),
]

function fixture() {
  const wb = XLSX.utils.book_new()
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, sheet(rows), name)
  add('ACT_MASTER', [...tab(SPECS.ACT, [
    { actCode: 'ACT-AU-SA07.2', make: 'AUMA', series: 'SA', model: 'SA 07.2', minTorque: 10, maxTorque: 30 },
    { actCode: 'ACT-RT-K300', make: 'Rotork', series: 'K-series', model: 'K300', maxTorque: 457, price: 1000, leadTimeWeeks: 6 },
    {}, { actCode: 'footnote only' },
  ])])
  // AUMA block, then the Viral block with its own header row (as in the live sheet)
  add('GB_MASTER', [
    ...tab(SPECS.GB, [{ gbCode: 'GB-AU-50.3', make: 'AUMA', model: 'GS 50.3', maxOutputTorque: 500 }]),
    [], ['Viral Industries (Ahmedabad) — GMD regular gearbox supplier'],
    ...tab(SPECS.VGB, [
      { gbCode: 'GB-VI-VWESGA80', make: 'Viral', model: 'VWESGA-80', maxOutputTorque: 8000, erpCode: 'RL1010012', type: 'Worm (part-turn)', price: 17625 },
      { gbCode: 'GB-VI-VWE07', make: 'Viral', model: 'VWE-07', maxOutputTorque: 700, erpCode: '—', type: 'Worm (part-turn)', price: 4200 },
      { gbCode: 'GB-VI-SGB8000', make: 'Viral', model: 'SGB-8000 + hand wheel', maxOutputTorque: 8000, erpCode: 'RSU010004?', type: 'Spur (multi-turn)', price: 76000 },
    ]).slice(2),
  ])
  add('VALVE_TORQUE', [['T'], [], ['PN16 multiplier', 1.25, 'note'], ['Safety factor', 1.3], [], ...tab(SPECS.VT, [{ key: 'BFV|100', valveType: 'BFV', dn: 100 }]).slice(2)])
  add('MAPPING', tab(SPECS.MAP, [
    { mapKey: 'BFV|100|PN10', valveType: 'BFV', dn: 100, pn: 'PN10', stockRotorkNm: 51, stockRotorkQty: 4 },
    { mapKey: 'SLUICE|700|PN10', valveType: 'SLUICE', dn: 700, pn: 'PN10', stockRotorkNm: 'none', stockRotorkQty: 0 },
  ]))
  add('GMD_GB_STOCK', tab(SPECS.GBS, [{ erpCode: 'RED070005', gbType: 'WORM', available: 51 }, { erpCode: 'TOTAL', available: 51 }]))
  add('STOCK_ACT', tab(SPECS.STK, [
    { erpCode: 'RCB040003', ratingCode: 'K300/RPM24', series: 'K-series' },
    { erpCode: 'RZZ', ratingCode: 'SA5', series: 'SA-series' },
    { erpCode: 'TOTAL' },
  ]))
  add('SUITABILITY', [['T'], [], [], [],
    ['MAP KEY', 'VALVE TYPE', 'Rotork K300', 'AUMA SA 07.2', 'GMD GB RED070005'],
    ['Rating (Nm) →', null, 457, 30, 1000],
    ['BFV|100|PN10', 'BFV', '○', '✔', null],
    ['SLUICE|700|PN10', 'SLUICE', null, '○', 'n/a'],
    ['VALVE TYPE APPLICABILITY', 'x']])
  // AUMA_RANGE as the live sheet returns it: numbers as text, a price table, then the speed table (1-ph rows first, then 3-ph).
  add('AUMA_RANGE', [['AUMA India actuator range'], ['Source'], [],
    ['MODEL', '3-PH MAX TORQUE (Nm)', '3-PH MAX RPM AT FULL TORQUE', '3-PH PRICE (₹)'], ['SA 3', '30', '180', '54900'], [],
    ['SPEED TABLE — every AUMA India model / speed / phase'],
    ['MODEL', 'PHASE', 'OUTPUT SPEED (rpm)', 'MAX TORQUE (Nm)', 'MOTOR kW'],
    ['SA 3', '1-ph 230 V', '11', '30', '0.06'], ['SA 6', '3-ph 415 V', '125', '55', '0.37'], ['SA 6', '3-ph 415 V', '4', '60', '0.37'], ['note only']])
  add('AUMA_ROTORK_ALT', ALT_ROWS)
  return wb
}

// GB_MASTER rows 48-82 of the live sheet (20 Nov): Viral's 19-Nov worm and spur tables, below the AUMA and old Viral blocks.
// No TYPE column; the spur header leaves the act flange and ERP code cells blank (the codes are still in the rows).
const VIRAL_19NOV: unknown[][] = [
  [],
  ['Viral part-turn worm gearbox — SELECTION TABLE used by MAPPING. Technical data & list price from Viral Industries mail 19-Nov-2026 (worm gear box price with technical details for GM Dalui). MA = mechanical advantage → actuator input torque = output torque ÷ MA. RATE USED = lower of last GMD bill/PO and Viral list (rate increase not accepted).'],
  ['GB CODE', 'MAKE', 'MODEL', 'MAX OUTPUT TORQUE (Nm)', 'MA (±10%)', 'RATIO', 'VALVE MOUNTING FLANGE', 'ACT MOUNTING FLANGE', 'MAX SPINDLE DIA (mm)', 'GMD ERP CODE', 'RATE USED (₹)', 'RATE NOTE', 'PRICE STATUS', 'VIRAL LIST PRICE 19-Nov-26 (₹)', 'LAST GMD BILL / PO (₹)'],
  ['GB-VI-VWE07', 'Viral', 'VWE-07', 800, 14, '40:1', 'F07, F10', 'F10', 35, '', 4200, 'Bill/PO 4,200 (Bill 868 Mar-26) vs list 4,300 – list higher: negotiate', 'Quoted', 4300, 4200],
  ['GB-VI-VWE10', 'Viral', 'VWE-10', 1000, 15, '42:1', 'F10, F12', 'F10', 45, 'RED070005', 4800, 'Bill/PO 4,800 (Bill 868 Mar-26) vs list 5,800 – list higher: negotiate', 'Quoted', 5800, 4800],
  ['GB-VI-VWE15', 'Viral', 'VWE-15', 1500, 16, '42:1', 'F12, F14', 'F10', 50, 'RET010002', 6400, 'Bill/PO 7,200 (Bill 841 Mar-26) vs list 6,400 – list lower: use list', 'Quoted', 6400, 7200],
  ['GB-VI-VWE20', 'Viral', 'VWE-20', 2000, 20, '52:1', 'F12, F14, F16', 'F10', 55, 'RL1030007', 7500, 'Bill/PO 7,800 (PO PE25Y-00064) vs list 7,500 – list lower: use list', 'Quoted', 7500, 7800],
  ['GB-VI-VWE30', 'Viral', 'VWE-30', 3000, 20, '52:1', 'F14, F16', 'F10', 60, 'RET010015', 9500, 'Bill/PO 9,750 (PO PE25Y-00064) vs list 9,500 – list lower: use list', 'Quoted', 9500, 9750],
  ['GB-VI-VWE40', 'Viral', 'VWE-40', 4000, 21, '55:1', 'F16, F25', 'F10', 70, 'RL1030004', 13600, 'Bill/PO 13,950 (PO PE25Y-00064) vs list 13,600 – list lower: use list', 'Quoted', 13600, 13950],
  ['GB-VI-VWESGA40', 'Viral', 'VWESGA-40', 4000, 54, '165:1', 'F16, F25', 'F10', 70, '', 15000, 'Viral list 19-Nov-26 only (not bought yet)', 'Quoted', 15000],
  ['GB-VI-VWESGA60', 'Viral', 'VWESGA-60', 6000, 62, '194:1', 'F16, F25', 'F10', 80, 'RL2010004', 16000, 'Bill/PO 17,000 (Bill 627 Dec-25) vs list 16,000 – list lower: use list', 'Quoted', 16000, 17000],
  ['GB-VI-VWESGA80', 'Viral', 'VWESGA-80', 8000, 70, '220:1', 'F16, F25', 'F10', 80, 'RL1010012', 17625, 'Bill/PO 17,625 (Bill 841 Mar-26) vs list 19,500 – list higher: negotiate', 'Quoted', 19500, 17625],
  ['GB-VI-VWESGA100', 'Viral', 'VWESGA-100', 10000, 95, '300:1', 'F16, F25, F30', 'F10, F14', 85, 'RL1010024', 25380, 'Bill/PO 25,380 (PO PE25Y-00064) vs list 31,500 – list higher: negotiate', 'Quoted', 31500, 25380],
  ['GB-VI-VWESGA150', 'Viral', 'VWESGA-150', 15000, 143, '449:1', 'F30, F35', 'F10, F14', 100, 'RL2010003', 32000, 'Bill/PO 32,000 (Bill 841 Mar-26) vs list 35,000 – list higher: negotiate', 'Quoted', 35000, 32000],
  ['GB-VI-VWESGA250', 'Viral', 'VWESGA-250', 25000, 190, '605:1', 'F30, F35, F40', 'F10, F14, F16', 110, 'RL2020001', 45000, 'Bill/PO 45,000 (Bill 868 Mar-26) vs list 49,300 – list higher: negotiate', 'Quoted', 49300, 45000],
  ['GB-VI-VWESGA350', 'Viral', 'VWESGA-350', 35000, 320, '992:1', 'F35, F40', 'F10, F14, F16', 120, 'RL2020002', 69700, 'Bill/PO 78,950 (Bill 706 Jan-26) vs list 69,700 – list lower: use list', 'Quoted', 69700, 78950],
  ['GB-VI-VWESGA500', 'Viral', 'VWESGA-500', 50000, 340, '1039:1', 'F35, F40', 'F10, F14, F16', 155, 'RL1010019', 107500, 'Bill/PO 107,500 (Bills 435/629) vs list 115,000 – list higher: negotiate', 'Quoted', 115000, 107500],
  ['GB-VI-VWESGA750', 'Viral', 'VWESGA-750', 75000, 461, '1425:1', 'F35, F40, F48', 'F10, F14, F16', 185, '', 149500, 'Viral list 19-Nov-26 only (not bought yet)', 'Quoted', 149500],
  ['GB-VI-VWESGA1000', 'Viral', 'VWESGA-1000', 100000, 569, '1768:1', 'F40, F48', 'F10, F14, F16', 185, 'RL1030001', 181350, 'Bill/PO 181,350 (Bill 435 Sep-25) vs list 187,000 – list higher: negotiate', 'Quoted', 187000, 181350],
  ['GB-VI-VWESGA1500', 'Viral', 'VWESGA-1500', 150000, 655, '2109:1', 'F48, F60', 'F10, F14, F16', 230, 'RL1030002', 220000, 'Bill/PO 220,000 (Bills 866/868 Mar-26) vs list 255,000 – list higher: negotiate', 'Quoted', 255000, 220000],
  ['GB-VI-VWESGA2000', 'Viral', 'VWESGA-2000', 200000, 762, '2381:1', 'F48, F60', 'F10, F14, F16', 270, 'RL1030003', 274815, 'Bill/PO 274,815 (GMD stock rate) vs list 360,500 – list higher: negotiate', 'Quoted', 360500, 274815],
  ['GB-VI-VWESGA2500', 'Viral', 'VWESGA-2500', 250000, 800, '2510:1', 'F48, F60', 'F10, F14, F16', 300, '', 380000, 'Bill/PO 380,000 (Bill 435 Sep-25) vs list 440,000 – list higher: negotiate', 'Quoted', 440000, 380000],
  ['GB-VI-VWESGA3750', 'Viral', 'VWESGA-3750', 375000, 1051, '3332:1', 'F48, F60', 'F10, F14, F16 (confirm)', 300, '', 795000, 'Viral list 19-Nov-26 only (not bought yet)', 'Quoted', 795000],
  ['GB-VI-VWESGA5000', 'Viral', 'VWESGA-5000', 500000, 1208, '3808:1', 'F48, F60', 'F10, F14, F16 (confirm)', 350, '', 945000, 'Viral list 19-Nov-26 only (not bought yet)', 'Quoted', 945000],
  ['Ratings & MA per Viral 19-Nov-26 table (replaces catalogue/Aug-25 figures). List prices are for VW/VWSGA (hand-operated) — actuator version VWE/VWESGA to be confirmed if different. Not answered by Viral: 20,000 Nm box (RL1020001) and 250 Nm box (REC030023).'],
  [],
  ['Viral multi-turn SPUR gearbox (sluice valves) — Viral mail 19-Nov-2026. Note: SGB-8000 = 6,000 Nm and SGB-5000 = 4,500 Nm output.'],
  ['GB CODE', 'MAKE', 'MODEL', 'MAX OUTPUT TORQUE (Nm)', 'MA (±10%)', 'RATIO', 'VALVE MOUNTING FLANGE', '', 'MAX SPINDLE DIA (mm)', '', 'RATE USED (₹)', 'RATE NOTE', 'PRICE STATUS', 'VIRAL LIST PRICE 19-Nov-26 (₹)', 'LAST GMD BILL (₹)'],
  ['GB-VI-SGB300', 'Viral', 'SGB-300', 300, 2.6, '3:1', 'F10, F12', '', 30, '', 5000, 'Bill 5,000 (Bills 660/708) vs list 6,300 – list higher: negotiate', 'Quoted', 6300, 5000],
  ['GB-VI-SGB600', 'Viral', 'SGB-600', 600, 3.5, '4:1', 'F12, F14', '', 40, 'RSE010030', 6500, 'Bill 6,500 (Bills 660/706/708) vs list 8,400 – list higher: negotiate', 'Quoted', 8400, 6500],
  ['GB-VI-SGB1000', 'Viral', 'SGB-1000', 1000, 4.4, '5:1', 'F16, F25', '', 50, 'REC030002', 9100, 'Bill 9,100 (Bills 400/432) vs list 10,850 – list higher: negotiate', 'Quoted', 10850, 9100],
  ['GB-VI-SGB2000', 'Viral', 'SGB-2000', 2000, '8.8 / 7', '10:1 / 8:1', 'F25, F30', '', 80, '', 16500, 'Bill 16,500 (Bill 706) vs list 19,900 – list higher: negotiate', 'Quoted', 19900, 16500],
  ['GB-VI-SGB3000', 'Viral', 'SGB-3000', 3000, '8.8 / 7', '10:1 / 8:1', 'F25, F30', '', 90, '', 28500, 'Viral list 19-Nov-26 only', 'Quoted', 28500],
  ['GB-VI-SGB5000', 'Viral', 'SGB-5000', 4500, '10.6 / 8.8', '12:1 / 10:1', 'F30, F35', '', 100, '', 59000, 'Viral list 19-Nov-26 only', 'Quoted', 59000],
  ['GB-VI-SGB8000', 'Viral', 'SGB-8000', 6000, '12.3 / 10.6', '14:1 / 12:1', 'F30, F35', '', 120, 'RSU010004', 76000, 'Bill 76,000 (Bill 51 Apr-26) vs list 81,500 – list higher: negotiate', 'Quoted', 81500, 76000],
  ['GB-VI-SGB10000', 'Viral', 'SGB-10000', 10000, '16.7 / 14.1', '19:1 / 16:1', 'F30, F35, F40', '', 125, '', 119500, 'Viral list 19-Nov-26 only', 'Quoted', 119500],
]

/** The fixture with all four GB_MASTER blocks: AUMA, old Viral, then Viral's 19-Nov tables. */
function fixture19(rows = VIRAL_19NOV) {
  const wb = fixture()
  XLSX.utils.sheet_add_aoa(wb.Sheets.GB_MASTER, rows, { origin: -1 })
  return wb
}

test('fixture: rows are filtered, "none" is null, params read from above the table', () => {
  const p = parseActuatorWorkbook(fixture())
  assert.deepEqual(p.actuators.map((a) => a.actCode), ['ACT-AU-SA07.2', 'ACT-RT-K300'])
  assert.equal(p.actuators[1].price, 1000)
  assert.equal(p.actuators[1].leadTimeWeeks, 6)
  assert.equal(p.actuators[0].price, null)
  assert.deepEqual(p.params.map((x) => [x.name, x.value]), [['PN16 multiplier', 1.25], ['Safety factor', 1.3]])
  assert.equal(p.mappings.length, 2)
  assert.equal(p.mappings[1].stockRotorkNm, null)
  assert.deepEqual(p.gearboxStock.map((g) => g.erpCode), ['RED070005'])
  assert.deepEqual(p.actuatorStock.map((a) => [a.erpCode, a.actCode]), [['RCB040003', 'ACT-RT-K300'], ['RZZ', null]])
})

test('AUMA_RANGE speed table, AUMA_ROTORK_ALT Rotork torque drops and generic RM codes; a missing tab names itself', () => {
  const p = parseActuatorWorkbook(fixture())
  assert.deepEqual(p.aumaSpeeds, [{ model: 'SA 3', phase: '1-ph 230 V', rpm: 11, torque: 30 }, { model: 'SA 6', phase: '3-ph 415 V', rpm: 125, torque: 55 }, { model: 'SA 6', phase: '3-ph 415 V', rpm: 4, torque: 60 }])
  assert.deepEqual(p.rotorkDerates, ROTORK_DERATES)
  assert.deepEqual(p.rmCodes, RM_CODES)
  for (const tab of ['AUMA_RANGE', 'AUMA_ROTORK_ALT']) {
    const wb = fixture()
    delete wb.Sheets[tab]; wb.SheetNames = wb.SheetNames.filter((n) => n !== tab)
    assert.throws(() => parseActuatorWorkbook(wb), new RegExp(tab))
  }
})

test('old layout (no 19-Nov tables): GB_MASTER AUMA block stops at the Viral header; Viral ERP codes that are not real codes are blank', () => {
  const p = parseActuatorWorkbook(fixture())
  assert.deepEqual(p.gearboxes.map((g) => g.gbCode), ['GB-AU-50.3'])
  assert.deepEqual(p.viralGearboxes.map((g) => [g.gbCode, g.model, g.maxOutputTorque, g.erpCode, g.type, g.price]), [
    ['GB-VI-VWESGA80', 'VWESGA-80', 8000, 'RL1010012', 'Worm (part-turn)', 17625],
    ['GB-VI-VWE07', 'VWE-07', 700, null, 'Worm (part-turn)', 4200],
    ['GB-VI-SGB8000', 'SGB-8000 + hand wheel', 8000, null, 'Spur (multi-turn)', 76000],
  ])
})

test("19-Nov tables replace the old Viral block: price = RATE USED, type from the table's title, spur ERP code from the unnamed column", () => {
  const p = parseActuatorWorkbook(fixture19())
  const v = (model: string) => p.viralGearboxes.find((g) => g.model === model)!
  assert.equal(p.viralGearboxes.length, 29) // 21 worm + 8 spur; the old block's 3 rows are not counted again
  assert.deepEqual(p.gearboxes.map((g) => g.gbCode), ['GB-AU-50.3'])
  assert.deepEqual(v('VWE-15'), {
    gbCode: 'GB-VI-VWE15', make: 'Viral', model: 'VWE-15', maxOutputTorque: 1500, ma: '16', ratio: '42:1', baseFlange: 'F12, F14', actFlange: 'F10',
    erpCode: 'RET010002', price: 6400, rateNote: 'Bill/PO 7,200 (Bill 841 Mar-26) vs list 6,400 – list lower: use list', type: 'Worm (part-turn)',
  })
  assert.match(String(v('VWE-15').type), /worm/i)
  assert.deepEqual([v('SGB-600').erpCode, v('SGB-600').price, v('SGB-600').actFlange, v('SGB-600').baseFlange], ['RSE010030', 6500, null, 'F12, F14'])
  assert.doesNotMatch(String(v('SGB-600').type), /worm/i)
  assert.deepEqual([v('SGB-2000').ma, v('SGB-2000').ratio, v('SGB-2000').erpCode], ['8.8 / 7', '10:1 / 8:1', null])
  assert.deepEqual([v('VWESGA-40').erpCode, v('VWESGA-40').price], [null, 15000]) // not bought yet: no ERP code
  assert.equal(v('SGB-8000').erpCode, 'RSU010004')
})

test('19-Nov tables: a BFV needing ≥ 12,000 Nm gets a new VWESGA-150 at 32,000', () => {
  const { viralGearboxes } = parseActuatorWorkbook(fixture19())
  const s = selectActuator({ mapKey: 'BFV|700|PN16', actuatorItem: true, qty: 1, text: '' }, { ...MASTER, viralGearboxes }, new Map(), new Map()).selection
  assert.equal(s.requiredTorque, 14287)
  assert.deepEqual(s.gb, { source: 'viral', model: 'VWESGA-150', erpCode: 'RL2010003', gbCode: 'GB-VI-VWESGA150', torque: 15000, ratio: '449:1', rate: 32000, rateSource: 'SHEET', rateFlag: null })
})

test('a 19-Nov table whose title says neither worm nor spur fails loudly', () => {
  const rows = VIRAL_19NOV.map((r) => (String(r[0]).startsWith('Viral multi-turn') ? ['Viral gearboxes'] : r))
  assert.throws(() => parseActuatorWorkbook(fixture19(rows)), /worm or spur/)
})

test('a spacer or note row under a 19-Nov title is fine; a title naming both worm and spur fails', () => {
  const spaced = VIRAL_19NOV.flatMap((r) => (String(r[0]).startsWith('Viral multi-turn') ? [r, [], ['Prices valid till 31-Mar-27']] : [r]))
  assert.deepEqual(parseActuatorWorkbook(fixture19(spaced)).viralGearboxes, parseActuatorWorkbook(fixture19()).viralGearboxes) // same 29 rows, spur still spur
  const both = VIRAL_19NOV.map((r) => (String(r[0]).startsWith('Viral multi-turn') ? [`${r[0]} Use instead of worm boxes.`] : r))
  assert.throws(() => parseActuatorWorkbook(fixture19(both)), /worm or spur/)
})

test('19-Nov tables in either order: the spur table still takes its blank header names from the worm table', () => {
  const at = VIRAL_19NOV.findIndex((r) => String(r[0]).startsWith('Viral multi-turn'))
  const byCode = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.gbCode).localeCompare(String(b.gbCode)))
  const spurFirst = parseActuatorWorkbook(fixture19([[], ...VIRAL_19NOV.slice(at), ...VIRAL_19NOV.slice(0, at)])).viralGearboxes
  assert.deepEqual(byCode(spurFirst), byCode(parseActuatorWorkbook(fixture19()).viralGearboxes))
})

test('fixture: SUITABILITY becomes one row per (map key, code) with marks and ratings', () => {
  const s = parseActuatorWorkbook(fixture()).suitability
  assert.equal(s.length, 6)
  const get = (k: string, code: string) => s.find((r) => r.mapKey === k && r.code === code)!
  assert.equal(get('BFV|100|PN10', 'ACT-RT-K300').mark, '○')
  assert.equal(get('BFV|100|PN10', 'ACT-AU-SA07.2').mark, '✔')
  assert.equal(get('BFV|100|PN10', 'RED070005').mark, '')
  assert.equal(get('SLUICE|700|PN10', 'RED070005').mark, 'n/a')
  assert.deepEqual([get('BFV|100|PN10', 'RED070005').kind, get('BFV|100|PN10', 'RED070005').ratingNm], ['GB', 1000])
  assert.deepEqual([get('BFV|100|PN10', 'ACT-RT-K300').make, get('BFV|100|PN10', 'ACT-AU-SA07.2').make], ['Rotork', 'AUMA'])
})

test('unknown SUITABILITY column fails loudly', () => {
  const wb = fixture()
  wb.Sheets.SUITABILITY.C5.v = 'Rotork K999'
  assert.throws(() => parseActuatorWorkbook(wb), /K999/)
})

// The real workbook is not in git (tmp is ignored): runs only when present.
const REAL = path.join(__dirname, '..', '..', '..', 'tmp', 'GMD_Actuator_Master.xlsx')
test('real workbook: check keys match the workbook values', { skip: !existsSync(REAL) }, () => {
  const p = readActuatorWorkbook(REAL)
  assert.equal(p.mappings.length, 122)
  assert.equal(new Set(p.suitability.map((s) => s.mapKey)).size, 122)
  const m = (k: string) => p.mappings.find((r) => r.mapKey === k)!
  const mark = (k: string, code: string) => p.suitability.find((r) => r.mapKey === k && r.code === code)!.mark
  assert.equal(m('BFV|500|PN16').requiredTorque, 6198)
  assert.equal(m('BFV|500|PN16').aumaActCode, 'ACT-AU-SA14.2')
  assert.equal(m('BFV|500|PN16').gmdGbCode, 'RL1010012')
  assert.equal(m('BFV|500|PN16').stockRotorkNm, 228)
  assert.equal(m('SLUICE-RS|700|PN10').valveTorque, 900)
  assert.equal(m('SLUICE-RS|700|PN10').requiredTorque, 500)
  assert.equal(m('SLUICE-RS|700|PN10').stockRotorkNm, null)
  assert.equal(m('SLUICE-RS|700|PN10').aumaActCode, 'ACT-AU-SA14.6')
  assert.equal(m('KGV|150|PN10').valveTorque, 70)
  assert.equal(m('KGV|150|PN10').requiredTorque, 141)
  assert.equal(m('KGV|150|PN10').flangeCheck, 'Adaptor needed')
  assert.equal(mark('BFV|500|PN16', 'ACT-RT-K150'), '✔')
  assert.equal(mark('BFV|500|PN16', 'ACT-RT-K300'), '✔')
  assert.equal(mark('BFV|500|PN16', 'ACT-RT-K600'), '○')
  assert.equal(mark('BFV|500|PN16', 'ACT-RT-K30'), '')
  assert.equal(mark('SLUICE-RS|700|PN10', 'ACT-AU-SA14.6'), '✔')
  assert.equal(mark('SLUICE-RS|700|PN10', 'RED070005'), 'n/a')
  assert.equal(mark('KGV|150|PN10', 'ACT-AU-SA14.2'), '✔')
})

test('re-import update keeps stored price / lead time / offer when the workbook cell is blank', () => {
  const blank = updateData({ actCode: 'A', model: 'M', price: null, leadTimeWeeks: null, offerDate: null, remarks: null })
  assert.deepEqual(blank, { actCode: 'A', model: 'M', remarks: null }) // other blanks still overwrite
  const filled = updateData({ actCode: 'A', price: 1200, leadTimeWeeks: 0 })
  assert.deepEqual(filled, { actCode: 'A', price: 1200, leadTimeWeeks: 0 })
})

test('MAPPING still parses after the sheet renamed "GB FACTOR" to "AUMA GB FACTOR (ref)"', () => {
  const wb = fixture()
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.MAPPING, { header: 1, defval: null })
  rows[2] = rows[2].map((h) => (h === 'GB FACTOR' ? 'AUMA GB FACTOR (ref)' : h))
  wb.Sheets.MAPPING = sheet(rows)
  const p = parseActuatorWorkbook(wb)
  assert.equal(p.mappings.length, 2)
  assert.equal(p.mappings[0].gbFactor, null)
})

test('STOCK_ACT still parses after the sheet dropped the "DISPATCHED 26-27" column', () => {
  const wb = fixture()
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.STOCK_ACT, { header: 1, defval: null })
  rows[2] = rows[2].map((h) => (h === 'DISPATCHED 26' ? 'WIRING DIAGRAM STATUS (20-Nov-26)' : h))
  wb.Sheets.STOCK_ACT = sheet(rows)
  const p = parseActuatorWorkbook(wb)
  assert.equal(p.actuatorStock[0].dispatched2627, null)
})

test('a required column that is missing still fails loudly', () => {
  const wb = fixture()
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.MAPPING, { header: 1, defval: null })
  rows[2] = rows[2].map((h) => (h === 'REQUIRED TORQUE' ? 'NEEDED TORQUE' : h))
  wb.Sheets.MAPPING = sheet(rows)
  assert.throws(() => parseActuatorWorkbook(wb), /REQUIRED TORQUE/)
})

// Imported (TFW) valves, 23 Nov 2026
const tfw = (rows: unknown[][] = TFW_ROWS) => {
  const wb = fixture()
  XLSX.utils.book_append_sheet(wb, sheet(rows), 'IMPORTED_VALVE_DATA (TFW)')
  return parseActuatorWorkbook(wb).imported
}
const imp = (rows: ReturnType<typeof tfw>, key: string) => rows.find((r) => r.mapKey === key)

test('IMPORTED_VALVE_DATA (TFW): sluice rows take torque with SF and turns, "PN16 (also used for PN10)" gives both PNs', () => {
  const rows = tfw()
  assert.deepEqual(imp(rows, 'SLUICE-IMP|350|PN16'), { mapKey: 'SLUICE-IMP|350|PN16', valveType: 'SLUICE-IMP', dn: 350, pn: 'PN16', requiredTorque: 325, turns: 30, valveFlange: null })
  assert.deepEqual(imp(rows, 'SLUICE-IMP|350|PN10'), { mapKey: 'SLUICE-IMP|350|PN10', valveType: 'SLUICE-IMP', dn: 350, pn: 'PN10', requiredTorque: 325, turns: 30, valveFlange: null })
  const pick = (k: string) => [imp(rows, k)?.requiredTorque, imp(rows, k)?.turns]
  assert.deepEqual(pick('SLUICE-IMP|350|PN25'), [490, 60]) // typed as text in the sheet
  assert.deepEqual(pick('SLUICE-IMP|1000|PN16'), [1867, 75]) // the late row under the PN25 rows
  assert.deepEqual(pick('SLUICE-IMP|150|PN16'), [150, 37.5])
  assert.equal(imp(rows, 'SLUICE-IMP|1000|PN10'), undefined) // its PN cell says PN16 only
  assert.equal(new Set(rows.map((r) => r.mapKey)).size, rows.length)
  assert.equal(rows.filter((r) => r.valveType === 'SLUICE-IMP').length, 17 * 2 + 10 + 1)
})

test('TFW block B only gives the top flange of the DN600+ sluice rows; its torque is never read', () => {
  const rows = tfw()
  assert.deepEqual(['600|PN16', '700|PN16', '700|PN10', '900|PN16', '500|PN16', '500|PN25', '1000|PN16', '1200|PN16'].map((k) => imp(rows, `SLUICE-IMP|${k}`)?.valveFlange),
    ['F16', 'F25', 'F25', 'F25', null, null, null, null])
  assert.equal(imp(rows, 'SLUICE-IMP|600|PN25'), undefined) // no DN600 PN25 torque row: block B alone makes no row
  assert.equal(imp(rows, 'SLUICE-IMP|700|PN16')?.requiredTorque, 930)
})

test('TFW: a title line ends the block above it, so a renamed header in block B never feeds its rows to block A', () => {
  const b = TFW_ROWS.findIndex((r) => r[2] === 'SHAFT DIA (mm)')
  const renamed = TFW_ROWS.map((r, i) =>
    i === b ? ['DN (mm)', ...r.slice(1)] : i > b && i <= b + 7 ? [r[0], r[1], 45, 60, ...r.slice(4)] : r) // shaft dia 45, shaft length 60, as the live sheet has
  const rows = tfw(renamed), base = tfw()
  for (const dn of [600, 700, 800]) assert.equal(imp(rows, `SLUICE-IMP|${dn}|PN25`), undefined) // not 60 Nm / 45 turns from the shaft cells
  const noFlange = (x: typeof rows) => x.map((r) => ({ ...r, valveFlange: null }))
  assert.deepEqual(noFlange(rows), noFlange(base)) // block A and C unchanged; only block B's bracket flanges are lost
  assert.deepEqual(imp(rows, 'SLUICE-IMP|700|PN16'), { ...imp(base, 'SLUICE-IMP|700|PN16')!, valveFlange: null })
  assert.equal(imp(rows, 'BFV-IMP|300|PN16')?.valveFlange, 'F10')
})

test('TFW block C: butterfly rows take torque with SF and the ISO 5211 flange, quarter turn; double flanged wins over wafer', () => {
  const rows = tfw()
  assert.deepEqual(imp(rows, 'BFV-IMP|300|PN16'), { mapKey: 'BFV-IMP|300|PN16', valveType: 'BFV-IMP', dn: 300, pn: 'PN16', requiredTorque: 958.8, turns: null, valveFlange: 'F10' })
  assert.equal(imp(rows, 'BFV-IMP|600|PN16')?.requiredTorque, 4453.2)
  assert.equal(rows.filter((r) => r.valveType === 'BFV-IMP').length, 14)
  assert.equal(imp(rows, 'BFV-IMP|300|PN10'), undefined) // TFW gives PN16 only
})

test('TFW tab missing, empty or unreadable: imported is empty and the Indian data still parses', () => {
  const p = parseActuatorWorkbook(fixture())
  assert.deepEqual(p.imported, [])
  assert.equal(p.mappings.length, 2)
  assert.deepEqual(tfw([]), [])
  assert.deepEqual(tfw([['IMPORTED VALVE DATA'], [], ['SIZE', 'RATING'], [350, 'PN16', 30, 325]]), []) // headers renamed: no rows, no error
  // a sluice row with a torque but no turns is not usable (never DN ÷ 6.35 on an imported valve); "—" is no value
  assert.deepEqual(tfw([TFW_ROWS[3], [350, 'PN16', '—', 325], [400, 'PN16', 34, '—'], [450, 'PN16', 38, 425]]).map((r) => r.mapKey), ['SLUICE-IMP|450|PN16'])
})

test('STOCK_ACT still parses after the sheet dropped its "STATUS" column (23 Nov 2026)', () => {
  const wb = fixture()
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.STOCK_ACT, { header: 1, defval: null })
  const at = rows.findIndex((r) => r[0] === 'ERP CODE')
  // The live header keeps "WIRING DIAGRAM STATUS (20-Nov-26)", which must not be read as STATUS.
  rows[at] = rows[at].map((h) => (h === 'STATUS' ? 'KWSS ALLOCATION' : h === 'MOVING' || h === 'STOCK VALUE' ? null : h))
  wb.Sheets.STOCK_ACT = sheet(rows)
  const p = parseActuatorWorkbook(wb)
  assert.ok(p.actuatorStock.length > 0)
  assert.equal(p.actuatorStock[0].status, null)
  assert.ok(p.actuatorStock.every((r: any) => r.stockValue === null)) // blank, never 0: the stock value tile then shows "–"
})
