import test from 'node:test'
import assert from 'node:assert/strict'
import { inThisWeek, ownerMatches, promisedThisWeek, topByOverdue, UNASSIGNED } from '../lib/debtorsViews.js'

const wed = new Date(2026, 10, 4) // Wed 4 Nov 2026; week is Mon 2 - Sun 8

test('week is Mon-Sun, local', () => {
  assert.equal(inThisWeek('2026-11-02', wed), true)
  assert.equal(inThisWeek('2026-11-08', wed), true)
  assert.equal(inThisWeek('2026-11-01', wed), false)
  assert.equal(inThisWeek('2026-11-09', wed), false)
  assert.equal(inThisWeek(null, wed), false)
  assert.equal(inThisWeek('2026-11-08', new Date(2026, 10, 8)), true) // Sunday belongs to the week ending that day
})

test('promised this week sums parsed amounts of in-week dates only', () => {
  const r = promisedThisWeek([
    { promisedDate: '2026-11-03', promisedAmount: '1,50,000' },
    { promisedDate: '2026-11-05', promisedAmount: 'tbd' },
    { promisedDate: '2026-11-20', promisedAmount: '999' },
  ], wed)
  assert.deepEqual(r, { total: 150000, count: 2 })
})

test('top by overdue ranks, drops zero, caps', () => {
  const ps = Array.from({ length: 12 }, (_, i) => ({ overdue: i }))
  const top = topByOverdue(ps)
  assert.equal(top.length, 10)
  assert.equal(top[0].overdue, 11)
  assert.ok(top.every((p) => p.overdue > 0))
})

test('owner filter groups blanks as Unassigned', () => {
  assert.equal(ownerMatches(null, UNASSIGNED), true)
  assert.equal(ownerMatches('Ravi', UNASSIGNED), false)
  assert.equal(ownerMatches('Ravi', 'Ravi'), true)
  assert.equal(ownerMatches(null, ''), true)
})
