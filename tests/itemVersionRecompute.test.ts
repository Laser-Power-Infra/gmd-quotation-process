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

test('single plain row lands its balance in V1', () => {
  const { updates, deletes } = planIndentRecompute([row({ id: 'a', totalBalBillAgCont: 0 })])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], {
    id: 'a',
    item: 'SLV',
    totalBalBillAgCont: 0,
    v1: '0',
    v2: '',
    v3: '',
    v4: '',
  })
})

test('merges colliding SLV-family rows, sums totals, splits balances per variant', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 10 }),
    row({ id: 'b', item: 'SLV-9523', totalBalBillAgCont: 5 }),
    row({ id: 'c', item: 'SLV RISING', totalBalBillAgCont: 2 }),
    row({ id: 'd', item: 'SLV-RISING-9523', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 3)
  assert.deepEqual([...deletes].sort(), ['b', 'c', 'd'])
  assert.equal(updates[0].id, 'a')
  assert.equal(updates[0].item, 'SLV')
  assert.equal(updates[0].totalBalBillAgCont, 20)
  assert.equal(updates[0].v1, '10')
  assert.equal(updates[0].v2, '5')
  assert.equal(updates[0].v3, '2')
  assert.equal(updates[0].v4, '3')
})

test('rows in the same slot are summed into that column', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'SLV-9523', totalBalBillAgCont: 5 }),
    row({ id: 'b', item: 'SLV 9523', totalBalBillAgCont: 7 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].v2, '12')
  assert.equal(updates[0].v1, '')
  assert.equal(updates[0].totalBalBillAgCont, 12)
})

test('DPCV maps DI->V1, CS->V2, 9523->V4 and leaves V3 blank', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'DPCV-DI', totalBalBillAgCont: 4 }),
    row({ id: 'b', item: 'DPCV-CS', totalBalBillAgCont: 6 }),
    row({ id: 'c', item: 'DPCV-9523', totalBalBillAgCont: 8 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'DPCV')
  assert.equal(updates[0].totalBalBillAgCont, 18)
  assert.equal(updates[0].v1, '4')
  assert.equal(updates[0].v2, '6')
  assert.equal(updates[0].v3, '')
  assert.equal(updates[0].v4, '8')
})

test('BFV maps plain->V1, DI->V2, WAFER->V3, 9523->V4', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'BFV', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'BFV-DI', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'BFV-WAFER', totalBalBillAgCont: 3 }),
    row({ id: 'd', item: 'BFV-9523', totalBalBillAgCont: 4 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'BFV')
  assert.deepEqual(
    [updates[0].v1, updates[0].v2, updates[0].v3, updates[0].v4],
    ['1', '2', '3', '4'],
  )
  assert.equal(updates[0].totalBalBillAgCont, 10)
})

test('NRV unmapped suffix falls into the spare V2 slot', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'NRV-DI', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'NRV-CS', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'NRV-9523', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'NRV')
  assert.equal(updates[0].v1, '1')
  assert.equal(updates[0].v2, '2')
  assert.equal(updates[0].v3, '')
  assert.equal(updates[0].v4, '3')
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
    row({ id: 'y', item: 'BALL FLOAT' }),
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
  assert.equal(updates[0].v2, '0')
})

test('distinct base keys stay separate even with same size/pn/status', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV' }),
    row({ id: 'b', item: 'BFV' }),
  ])
  assert.equal(updates.length, 2)
  assert.equal(deletes.length, 0)
})

test('amounts are rounded to two decimals', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 1.2345 }),
  ])
  assert.equal(updates[0].v1, '1.23')
  assert.equal(updates[0].totalBalBillAgCont, 1.2345)
})
