import test from 'node:test'
import assert from 'node:assert/strict'
import { mapDebtorRow, parseAmount, parseSheetDate, resolveDebtorColumns, DEBTORS_HEADERS } from '../lib/debtorsSync.js'

const HEADERS = Object.values(DEBTORS_HEADERS)
const idx = resolveDebtorColumns(HEADERS, 'DEBTORS')

function rowWith(overrides: Partial<Record<keyof typeof DEBTORS_HEADERS, string>>): string[] {
  const base: Record<keyof typeof DEBTORS_HEADERS, string> = {
    accSch: 'D', accCode: 'DAC01', tCode: 'S', vrNo: 'GD22Y-00059',
    drAmt: '961105', vrDate: '22-03-2023', dueDate: '21-04-2023',
    particular: 'Sales against Challan', drAllocAmt: '', unAllocDr: '961105',
    unAllocCr: '0', partyBillNo: 'GD22Y-00059', partyBillDate: '22-03-2023',
    accName: 'ACHME WATER SOLUTIONS PVT. LTD.',
  }
  const merged = { ...base, ...overrides }
  return HEADERS.map((h) => merged[(Object.keys(DEBTORS_HEADERS) as (keyof typeof DEBTORS_HEADERS)[])
    .find((k) => DEBTORS_HEADERS[k] === h)!])
}

test('parseAmount: blank is null, commas stripped, text is an error', () => {
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('  '), null)
  assert.equal(parseAmount('20000.38'), 20000.38)
  assert.equal(parseAmount('1,053,895'), 1053895)
  assert.equal(parseAmount('0'), 0)
  assert.throws(() => parseAmount('abc'), /not a number/)
})

test('parseSheetDate: DD-MM-YYYY to UTC midnight, blank is null', () => {
  assert.equal(parseSheetDate(''), null)
  assert.equal(parseSheetDate('22-03-2023')?.toISOString(), '2023-03-22T00:00:00.000Z')
  assert.equal(parseSheetDate('1-4-2025')?.toISOString(), '2025-04-01T00:00:00.000Z')
  assert.throws(() => parseSheetDate('2023-03-22'), /DD-MM-YYYY/)
  assert.throws(() => parseSheetDate('31-02-2023'), /invalid date/)
})

test('mapDebtorRow maps every column to its Debtor field', () => {
  const result = mapDebtorRow(rowWith({}), idx)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.record, {
    accSch: 'D',
    accCode: 'DAC01',
    tCode: 'S',
    vrNo: 'GD22Y-00059',
    drAmt: 961105,
    vrDate: new Date('2023-03-22T00:00:00.000Z'),
    dueDate: new Date('2023-04-21T00:00:00.000Z'),
    particular: 'Sales against Challan',
    drAllocAmt: null,
    unAllocDr: 961105,
    unAllocCr: 0,
    partyBillNo: 'GD22Y-00059',
    partyBillDate: new Date('2023-03-22T00:00:00.000Z'),
    accName: 'ACHME WATER SOLUTIONS PVT. LTD.',
  })
})

test('mapDebtorRow skips rows without ACC_CODE and keeps blank TCODE or VRNO', () => {
  assert.deepEqual(mapDebtorRow(rowWith({ accCode: ' ' }), idx), { ok: false, error: 'blank ACC_CODE' })
  const blankKeys = mapDebtorRow(rowWith({ tCode: '', vrNo: '' }), idx)
  assert.equal(blankKeys.ok, true)
  if (!blankKeys.ok) return
  assert.equal(blankKeys.record.tCode, null)
  assert.equal(blankKeys.record.vrNo, null)
})

test('mapDebtorRow reports a bad number as a skip, not a zero', () => {
  const result = mapDebtorRow(rowWith({ drAmt: 'n/a' }), idx)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /not a number/)
})

test('resolveDebtorColumns fails when a header is missing', () => {
  assert.throws(() => resolveDebtorColumns(HEADERS.slice(1), 'DEBTORS'), /missing required column/)
})
