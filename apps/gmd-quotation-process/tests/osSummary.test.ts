import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOsSummary } from '../lib/osSummary.js'
import type { LedgerRow } from '../lib/debtorsAgeing.js'

const today = new Date(2026, 10, 2)
const row = (o: Partial<LedgerRow>): LedgerRow => ({
  accCode: 'A', accName: 'Acme', dueDate: null, vrDate: null, unAllocDr: 0, unAllocCr: 0, ...o,
})

test('debtors total, overdue, >45 days and creditors net payable', () => {
  const s = buildOsSummary([
    row({ unAllocDr: 1_000_000, vrDate: '2026-08-01T00:00:00.000Z', dueDate: '2026-09-01T00:00:00.000Z' }), // >45 days, overdue
    row({ unAllocDr: 500_000, vrDate: '2026-10-20T00:00:00.000Z', dueDate: '2026-12-01T00:00:00.000Z' }), // fresh, not due
    row({ accCode: 'B', unAllocCr: 200_000 }), // unadjusted credit
  ], { totalDues: 3_000_000, overdue: 1_000_000, credits: 500_000, net: 2_500_000 }, today,
  { msmeDays: 45, debtorsSyncedAt: null, creditorsSyncedAt: null })

  assert.equal(s.date, '2026-11-02')
  assert.deepEqual(
    { total: s.debtors.totalDues, overdue: s.debtors.overdue, over45: s.debtors.over45, credits: s.debtors.credits, net: s.debtors.net },
    { total: 1_500_000, overdue: 1_000_000, over45: 1_000_000, credits: 200_000, net: 1_300_000 },
  )
  assert.equal(s.creditors.netPayable, 2_500_000)
  assert.equal(s.creditors.advances, 500_000)
  assert.match(s.text, /Debtors: ₹13\.00 L net .*>45 days ₹10\.00 L/)
  assert.match(s.text, /Creditors: ₹25\.00 L net payable/)
  assert.ok(s.text.split('\n').length <= 4) // short enough for a group message
})
