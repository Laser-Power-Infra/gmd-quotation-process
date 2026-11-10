import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { parseActuatorWorkbook, readActuatorWorkbook, SPECS, updateData } from '../lib/actuatorMaster.js'

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
  add('GB_MASTER', tab(SPECS.GB, [{ gbCode: 'GB-AU-50.3', make: 'AUMA', model: 'GS 50.3', maxOutputTorque: 500 }]))
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
