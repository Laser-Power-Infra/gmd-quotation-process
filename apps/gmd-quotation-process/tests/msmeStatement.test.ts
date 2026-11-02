import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInterestStatement } from '../lib/msmeStatement.js'
import { DEFAULT_MSME_SETTINGS } from '../lib/msme.js'

const today = new Date(2026, 10, 2) // 2 Nov 2026

test('statement lists only overdue bills with due date, days and interest', () => {
  const r = buildInterestStatement(
    [
      { billNo: 'B1', vrDate: '2025-10-17T00:00:00.000Z', bal: 100000 }, // due 1 Nov 2025 (15d), 12 months, 366 days
      { billNo: 'B2', vrDate: '2026-10-25T00:00:00.000Z', bal: 5000 }, // due 9 Nov 2026: not overdue
      { billNo: 'B3', vrDate: '2025-01-01T00:00:00.000Z', bal: -50 }, // credit: skipped
      { billNo: 'B4', vrDate: null, bal: 10 },
    ],
    null,
    DEFAULT_MSME_SETTINGS,
    today,
  )
  assert.equal(r.lines.length, 1)
  assert.equal(r.lines[0].dueDate, '2025-11-01')
  assert.equal(r.lines[0].daysOverdue, 366)
  assert.equal(Math.round(r.lines[0].interest * 100) / 100, 18681.34)
  assert.equal(r.total, r.principal + r.interest)
})

test('agreed credit days are capped at 45', () => {
  const r = buildInterestStatement([{ billNo: 'B', vrDate: '2026-01-01T00:00:00.000Z', bal: 100 }], 90, DEFAULT_MSME_SETTINGS, today)
  assert.equal(r.lines[0].dueDate, '2026-02-15')
})
