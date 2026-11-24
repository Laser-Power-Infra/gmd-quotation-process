import test from 'node:test'
import assert from 'node:assert/strict'
import { splitPurchaseAllocations, checkCapacity } from '../src/purchaseAllocation'

const allocs = [
  { id: 'a', qty: 40, allocatedAt: '2026-11-01T00:00:00Z' },
  { id: 'b', qty: 30, allocatedAt: '2026-11-02T00:00:00Z' },
]
const row = (r: ReturnType<typeof splitPurchaseAllocations>, id: string) => r.perAlloc.find((p) => p.id === id)!

test('nothing received: all incoming, rest of the line is free incoming', () => {
  const r = splitPurchaseAllocations({ ordered: 100, received: 0, closed: false }, allocs)
  assert.equal(row(r, 'a').incomingQty, 40)
  assert.equal(row(r, 'b').incomingQty, 30)
  assert.equal(r.freeIncoming, 30)
})

test('receipt covers allocations oldest first', () => {
  const r = splitPurchaseAllocations({ ordered: 100, received: 50, closed: false }, [allocs[1], allocs[0]])
  assert.deepEqual(row(r, 'a'), { id: 'a', physicalQty: 40, incomingQty: 0, shortQty: 0 })
  assert.deepEqual(row(r, 'b'), { id: 'b', physicalQty: 10, incomingQty: 20, shortQty: 0 })
  assert.equal(r.freeIncoming, 30)
})

test('closed line with short receipt: shortage, no incoming', () => {
  const r = splitPurchaseAllocations({ ordered: 100, received: 60, closed: true }, allocs)
  assert.deepEqual(row(r, 'b'), { id: 'b', physicalQty: 20, incomingQty: 0, shortQty: 10 })
  assert.equal(r.freeIncoming, 0)
})

test('over-receipt leaves allocations unchanged and never goes negative', () => {
  const r = splitPurchaseAllocations({ ordered: 100, received: 120, closed: true }, allocs)
  assert.equal(row(r, 'a').physicalQty, 40)
  assert.equal(row(r, 'b').physicalQty, 30)
  for (const p of r.perAlloc) assert.ok(p.incomingQty === 0 && p.shortQty === 0)
  assert.equal(r.freeIncoming, 0)
})

test('NaN / negative input does not throw or go negative', () => {
  const r = splitPurchaseAllocations({ ordered: NaN, received: -5, closed: false }, [{ id: 'x', qty: NaN, allocatedAt: '' }])
  assert.deepEqual(row(r, 'x'), { id: 'x', physicalQty: 0, incomingQty: 0, shortQty: 0 })
  assert.equal(r.freeIncoming, 0)
})

test('checkCapacity', () => {
  assert.match(checkCapacity(100, 90, 20)!, /10/)
  assert.equal(checkCapacity(100, 90, 10), null)
  assert.equal(checkCapacity(null, 0, 5), 'purchase line has no ordered qty')
})
