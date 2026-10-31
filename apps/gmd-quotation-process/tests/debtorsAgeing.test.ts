import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketOf, daysOverdue, outstanding, summarise } from '../lib/debtorsAgeing.js'
import type { DebtorRow } from '../lib/debtors.js'

const today = new Date(2026, 9, 31)
const row = (o: Partial<DebtorRow>): DebtorRow => ({
  id: 'x', accSch: null, accCode: 'A', accName: 'Acme', tCode: null, vrNo: null, vrDate: null,
  dueDate: null, particular: null, drAmt: null, drAllocAmt: null, unAllocDr: 0, unAllocCr: 0,
  partyBillNo: null, partyBillDate: null, ...o,
})

test('days and buckets', () => {
  assert.equal(daysOverdue('2026-10-01T00:00:00.000Z', today), 30)
  assert.equal(daysOverdue('2026-11-05T00:00:00.000Z', today), -5)
  assert.equal(bucketOf(-5), 'Not due')
  assert.equal(bucketOf(30), '0-30')
  assert.equal(bucketOf(31), '31-60')
  assert.equal(bucketOf(90), '61-90')
  assert.equal(bucketOf(91), '91-180')
  assert.equal(bucketOf(181), '180+')
})

test('credits are separate, never netted into dues', () => {
  assert.equal(outstanding(row({ unAllocDr: 100, unAllocCr: 30 })), 70)
  const s = summarise([
    row({ unAllocDr: 1000, dueDate: '2026-01-01T00:00:00.000Z' }),
    row({ unAllocDr: 500, dueDate: '2026-12-01T00:00:00.000Z' }),
    row({ unAllocDr: 0, unAllocCr: 200 }),
  ], today)
  assert.equal(s.totalDues, 1500)
  assert.equal(s.overdue, 1000)
  assert.equal(s.over90, 1000)
  assert.equal(s.credits, 200)
  assert.equal(s.net, 1300)
  assert.equal(s.parties.length, 1)
})
