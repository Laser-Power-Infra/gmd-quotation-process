import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_DATE_PRESET,
  presetRange,
  fyOptions,
  yearOptions,
} from '../lib/supplyDatePreset.js'

test('financial year spans April to March', () => {
  assert.deepEqual(presetRange({ ...EMPTY_DATE_PRESET, fy: '2025-26' }), {
    dateFrom: '2025-04-01',
    dateTo: '2026-03-31',
  })
})

test('year alone spans the whole calendar year', () => {
  assert.deepEqual(presetRange({ ...EMPTY_DATE_PRESET, year: '2025' }), {
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31',
  })
})

test('month uses the real length of the month, including leap February', () => {
  assert.deepEqual(presetRange({ ...EMPTY_DATE_PRESET, year: '2024', month: '02' }), {
    dateFrom: '2024-02-01',
    dateTo: '2024-02-29',
  })
  assert.deepEqual(presetRange({ ...EMPTY_DATE_PRESET, year: '2025', month: '02' }), {
    dateFrom: '2025-02-01',
    dateTo: '2025-02-28',
  })
  assert.equal(presetRange({ ...EMPTY_DATE_PRESET, year: '2025', month: '04' }).dateTo, '2025-04-30')
})

test('year, month and day give a single-day range', () => {
  assert.deepEqual(presetRange({ fy: '', year: '2025', month: '07', day: '09' }), {
    dateFrom: '2025-07-09',
    dateTo: '2025-07-09',
  })
})

test('empty preset gives no range', () => {
  assert.deepEqual(presetRange(EMPTY_DATE_PRESET), { dateFrom: '', dateTo: '' })
})

test('fy options start at the current financial year', () => {
  assert.equal(fyOptions(new Date(2026, 3, 1))[0], '2026-27') // April starts the new FY
  assert.equal(fyOptions(new Date(2026, 2, 31))[0], '2025-26') // March is still the old FY
  assert.equal(fyOptions(new Date(2026, 5, 1), 2)[1], '2025-26')
})

test('year options count back from the current year', () => {
  assert.deepEqual(yearOptions(new Date(2026, 0, 1), 3), ['2026', '2025', '2024'])
})
