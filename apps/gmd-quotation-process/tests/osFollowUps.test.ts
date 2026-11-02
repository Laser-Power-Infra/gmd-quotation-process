import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOsFollowUpFeed } from '../lib/osFollowUps.js'
import type { FeedRow } from '../lib/osFollowUps.js'
import { EMPTY_FOLLOW_UP } from '../lib/debtorJoins.js'

const today = new Date(2026, 10, 2)
const row = (o: Partial<FeedRow>): FeedRow => ({
  accCode: 'A', accName: 'Acme', vrNo: null, dueDate: null, vrDate: null, unAllocDr: 0, unAllocCr: 0, ...o,
})

test('party feed: owner, contact, open bills with days overdue, promise missed, litigation excluded', () => {
  const feed = buildOsFollowUpFeed(
    [
      row({ vrNo: 'GD-1', unAllocDr: 100_000, vrDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-10-01T00:00:00.000Z' }), // 32 days overdue
      row({ vrNo: 'GD-2', unAllocDr: 50_000, vrDate: '2026-10-20T00:00:00.000Z' }), // no due date: ages from voucher, 13 days
      row({ vrNo: 'GD-3', unAllocDr: 20_000, vrDate: '2026-11-01T00:00:00.000Z', dueDate: '2026-11-07T00:00:00.000Z' }), // due in 5 days
      row({ vrNo: 'SR-1', unAllocCr: 10_000 }), // credit, not a bill
      row({ accCode: 'L', accName: 'Litigant', vrNo: 'GD-9', unAllocDr: 900_000, dueDate: '2026-01-01T00:00:00.000Z' }),
    ],
    { A: { ...EMPTY_FOLLOW_UP, owner: 'Koushal', contactPhone: '9999', clientType: 'Private', lastFollowUp: '2026-10-25', promisedDate: '2026-10-30', promisedAmount: '1,00,000' } },
    { L: { status: 'Filed' } },
    { 'GD-1': { orderNo: 'OD-1', poRef: 'PO-1', items: null, orderCopy: null, invoice: null, inspectionReport: null, driveLink: null } },
    today,
  )

  assert.equal(feed.date, '2026-11-02')
  assert.equal(feed.excluded.underLitigation, 1)
  assert.equal(feed.parties.length, 1)
  const a = feed.parties[0]!
  assert.equal(a.owner, 'Koushal')
  assert.equal(a.contact.phone, '9999')
  assert.deepEqual({ dues: a.totalDues, overdue: a.overdue, credits: a.credits, net: a.net }, { dues: 170_000, overdue: 150_000, credits: 10_000, net: 160_000 })
  assert.equal(a.oldestOverdueDays, 32)
  assert.equal(a.daysSinceFollowUp, 8)
  assert.equal(a.promisedAmount, 100_000)
  assert.equal(a.promiseMissed, true)
  assert.deepEqual(a.bills.map((b) => [b.vrNo, b.daysOverdue, b.dueDate, b.orderNo]), [
    ['GD-1', 32, '2026-10-01', 'OD-1'],
    ['GD-2', 13, '2026-10-20', null],
    ['GD-3', -5, '2026-11-07', null],
  ])
})

test('no follow-up row: nulls, promise not missed', () => {
  const feed = buildOsFollowUpFeed([row({ vrNo: 'GD-1', unAllocDr: 1, dueDate: '2026-10-01T00:00:00.000Z' })], {}, {}, {}, today)
  const a = feed.parties[0]!
  assert.equal(a.owner, null)
  assert.equal(a.promiseMissed, false)
  assert.equal(a.daysSinceFollowUp, null)
})
