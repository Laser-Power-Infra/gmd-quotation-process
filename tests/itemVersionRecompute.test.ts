import test from 'node:test'
import assert from 'node:assert/strict'
import { planIndentRecompute } from '../lib/itemVersionResolver.js'

function row(overrides: Partial<Parameters<typeof planIndentRecompute>[0][number]> = {}) {
  return {
    id: 'r1',
    item: 'SLV',
    size: '200',
    pnRating: 'PN - 16',
    mcReceivedPending: 'Received',
    totalBalBillAgCont: 0,
    ...overrides,
  }
}

test('single row with no extras stays as base item with blank versions', () => {
  const { updates, deletes } = planIndentRecompute([row({ id: 'a' })])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], {
    id: 'a',
    item: 'SLV',
    totalBalBillAgCont: 0,
    v1: '',
    v2: '',
    v3: '',
    v4: '',
  })
})

test('merges colliding rows into one, sums totals, keeps survivor', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 10 }),
    row({ id: 'b', item: 'SLV-9523', totalBalBillAgCont: 5 }),
    row({ id: 'c', item: 'SLV RISING', totalBalBillAgCont: 2 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 2)
  assert.deepEqual([...deletes].sort(), ['b', 'c'])
  assert.equal(updates[0].id, 'a')
  assert.equal(updates[0].item, 'SLV')
  assert.equal(updates[0].totalBalBillAgCont, 17)
  assert.equal(updates[0].v2, '9523')
  assert.equal(updates[0].v3, 'RISING')
})

test('same-column markers are comma-joined in the survivor', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 285 }),
    row({ id: 'b', item: 'SLV-9523', totalBalBillAgCont: 51 }),
    row({ id: 'c', item: 'SLV RISING-9523', totalBalBillAgCont: 2 }),
    row({ id: 'd', item: 'SLV RISING-CS', totalBalBillAgCont: 8 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].v2, '9523, CS')
  assert.equal(updates[0].v4, 'RISING 9523')
  assert.equal(updates[0].totalBalBillAgCont, 346)
})

test('prefers a row whose item is exactly the base as survivor', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'first', item: 'SLV-9523' }),
    row({ id: 'exact', item: 'SLV' }),
  ])
  assert.equal(updates[0].id, 'exact')
  assert.deepEqual([...deletes], ['first'])
})

test('non-base items are left untouched', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'x', item: 'AIR CUSHION' }),
    row({ id: 'y', item: 'diaphragm valve' }),
    row({ id: 'z', item: 'ZVV' }),
  ])
  assert.equal(updates.length, 0)
  assert.equal(deletes.length, 0)
})

test('blank item rows are untouched', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'x', item: '' }),
    row({ id: 'y', item: null }),
  ])
  assert.equal(updates.length, 0)
  assert.equal(deletes.length, 0)
})

test('case and whitespace in size/pn/status are normalized for grouping', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', size: ' 200 ', pnRating: 'PN - 16', mcReceivedPending: 'Received' }),
    row({ id: 'b', item: 'SLV-9523', size: '200', pnRating: '  PN - 16', mcReceivedPending: 'received' }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  assert.equal(updates[0].v2, '9523')
})

test('distinct base keys stay separate even with same size/pn/status', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV' }),
    row({ id: 'b', item: 'BFV' }),
  ])
  assert.equal(updates.length, 2)
  assert.equal(deletes.length, 0)
})

test('survivor keeps its own row; size/pn/status are never rewritten by the plan', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', size: '200', pnRating: 'PN - 16', mcReceivedPending: 'Received' }),
    row({ id: 'b', item: 'SLV-9523', size: '200', pnRating: 'PN - 16', mcReceivedPending: 'Received' }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  const u = updates[0]
  assert.ok(['a', 'b'].includes(u.id))
  assert.deepEqual(Object.keys(u).sort(), [
    'id',
    'item',
    'totalBalBillAgCont',
    'v1',
    'v2',
    'v3',
    'v4',
  ])
  assert.equal(u.item, 'SLV')
})