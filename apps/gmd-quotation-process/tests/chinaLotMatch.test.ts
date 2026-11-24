import test from 'node:test'
import assert from 'node:assert/strict'
import { matchLots, parseLotRows, type SheetRow, type PoLine } from '../lib/chinaLotMatch.js'

const row = (o: Partial<SheetRow> = {}): SheetRow => ({
  contractNo: 'SD26Y-00078', itemCode: 'FSC060011', size: '200', qty: 14, qtyRaw: '14', lot: '135 LOT',
  tinaInvoiceNo: 'WS26-340C (51th)', blStatus: 'SITGTXCC630764 - ETA Haldia 30-11', needsConfirmation: false, ...o,
})
const line = (o: Partial<PoLine> = {}): PoLine => ({ poNo: 'PC26Y-1', poLineNo: '1', itemCode: 'FSC060011', salesContract: null, partyRefNo: 'WS26-340C', ...o })

test('invoice + item matching exactly one line is matched', () => {
  const r = matchLots([row()], [line(), line({ poLineNo: '2', itemCode: 'OTHER' })])
  assert.equal(r.matched.length, 1)
  assert.deepEqual([r.matched[0].poNo, r.matched[0].poLineNo], ['PC26Y-1', '1'])
})

test('two candidate lines is ambiguous', () => {
  const r = matchLots([row()], [line(), line({ poLineNo: '2' })])
  assert.deepEqual(r.unmatched.map((u) => u.reason), ['ambiguous'])
})

test('no candidate is "no purchase line"', () => {
  const r = matchLots([row()], [line({ partyRefNo: 'BY MAIL' })])
  assert.deepEqual(r.unmatched.map((u) => u.reason), ['no purchase line'])
})

test('falls back to sales contract + item code', () => {
  const r = matchLots([row()], [line({ partyRefNo: 'BY MAIL', salesContract: 'SD26Y-00078 ; MC NO - OD26Y-1' })])
  assert.equal(r.matched.length, 1)
})

test('SD26Y-00058 FSD040002 and FSD040044 rows need confirmation; others do not', () => {
  const rows = parseLotRows([
    ['25C', 'SD26Y-00058', '(to fill)', 'UP', 'KALPATARU', 'FSD040002', '150', '323', 'Received', '136 LOT', 'WS26-340D (52th)', 'OOLU - ETA 09-12', '31 free + 179 from x = 323 (needs your OK)'],
    ['25D', 'SD26Y-00058', '(to fill)', 'UP', 'KALPATARU', 'FSD040044', '80', '598', 'Received', '136 LOT', 'WS26-340D (52th)', 'OOLU - ETA 09-12', '51 (taken from NCC)', '547'],
    ['25B', 'SD26Y-00058', '(to fill)', 'UP', 'KALPATARU', 'FSC060011', '200', '85', 'Received', '135 LOT', 'WS26-340C (51th)', 'SITG', '85'],
  ])
  assert.deepEqual(rows.map((r) => r.needsConfirmation), [true, true, false])
  // "31 free + 179 ..." and "51 (taken from NCC)" are not plain numbers: never read as 31 / 51
  assert.deepEqual(rows.map((r) => r.qty), [NaN, NaN, 85])
  assert.deepEqual(rows.map((r) => r.qtyRaw), ['31 free + 179 from x = 323 (needs your OK)', '51 (taken from NCC)', '85'])
})

const cell = (alloc: string) => parseLotRows([['1', 'SD26Y-1', 'p', 'x', 'k', 'FSD1', '150', '4', 'Received', '134 LOT', 'WS26-340B', 'SITG', alloc]])

test('QTY ALLOCATED is read only as a plain positive number', () => {
  assert.deepEqual(['31', '12.5'].map((a) => cell(a)[0].qty), [31, 12.5])
  for (const bad of ['1,200', '10 (of 20)', '40 + 20', '10-20', '0']) {
    const r = cell(bad)
    assert.ok(Number.isNaN(r[0].qty), bad)
    assert.equal(r[0].qtyRaw, bad)
    const m = matchLots(r, [line({ itemCode: 'FSD1', partyRefNo: 'WS26-340B' })])
    assert.equal(m.matched.length, 0)
    assert.deepEqual(m.unmatched.map((u) => u.reason), ['quantity not a plain number'])
  }
  assert.equal(cell('').length, 0) // blank cell stays skipped
})

test('continuation rows inherit contract/item; physical-stock and blank-lot rows are skipped', () => {
  const rows = parseLotRows([
    ['3', 'SD26Y-00062', 'p', 'JJMP', 'K', 'FSD040182', '150', '4', 'Received', 'Physical stock (app)', '—', '—', '1'],
    ['', '', '', '', '', '', '', '', '', '134 LOT', 'WS26-340B (50th)', 'SITG', '3'],
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].contractNo, rows[0].itemCode, rows[0].lot, rows[0].qty], ['SD26Y-00062', 'FSD040182', '134 LOT', 3])
})
