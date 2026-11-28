import test from 'node:test'
import assert from 'node:assert/strict'
import { stockPrisma } from '@gmd/db-stock'
import { loadPurchase } from '../src/server/purchaseLoad'

// stockPrisma mocked: nothing touches a database. The fake applies the same filter the real where clause states.
function mock(lines: any[], allocs: any[]) {
  const calls: any[] = []
  ;(stockPrisma as any).purchaseAllocation = { findMany: async () => allocs }
  ;(stockPrisma as any).purchaseOrderLine = {
    findMany: async (args: any) => {
      calls.push(args)
      return lines.filter((l) => args.where.OR.some((c: any) =>
        c.inTransit ? (l.inTransit ?? 0) > c.inTransit.gt && l.itemCode != null : c.poNo === l.poNo && c.poLineNo === l.poLineNo))
    },
  }
  return calls
}
const L = (poNo: string, o: any = {}) => ({ poNo, poLineNo: '1', itemCode: 'FSD1', netQtyOrder: '100', qtyExecuted: '0', balanceQty: '100', deliverySched: '1-Mar-2027', grnDate: null, inTransit: 100, ...o })
const A = (poNo: string, o: any = {}) => ({ id: poNo, poNo, poLineNo: '1', contractNo: 'C1', itemCode: 'FSD1', qty: 60, lot: null, tinaInvoiceNo: null, blNo: null, eta: null, shipStatus: null, needsConfirmation: false, allocatedAt: new Date('2026-11-01'), ...o })

test('loads open lines and allocated lines (closed included), skips zero-pending unallocated ones, in one ordered query', async () => {
  const closedAllocated = L('P2', { inTransit: 0, balanceQty: '0', qtyExecuted: '40' })
  const calls = mock([L('P1'), closedAllocated, L('P3', { inTransit: 0, balanceQty: '0' })], [A('P2')])
  const r = await loadPurchase(() => true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].orderBy, [{ poNo: 'asc' }, { poLineNo: 'asc' }])
  assert.deepEqual(r.views.map((v) => v.poNo), ['P1', 'P2'])
  assert.deepEqual([r.purchaseAllocations[0].physicalQty, r.purchaseAllocations[0].shortQty], [40, 20])
})

test('a large allocation list is chunked, still loading every allocated line once', async () => {
  const many = Array.from({ length: 1200 }, (_, i) => A(`Q${i}`, { qty: 1 }))
  const calls = mock(many.map((a) => L(a.poNo)), many)
  const r = await loadPurchase(() => true)
  assert.ok(calls.length > 1)
  assert.equal(r.views.length, 1200)
})

test('missing table degrades quietly; any other error degrades but is logged', async () => {
  const errs: any[] = []
  const orig = console.error
  console.error = (...a: any[]) => { errs.push(a) }
  try {
    ;(stockPrisma as any).purchaseAllocation = { findMany: async () => { throw Object.assign(new Error('no table'), { code: 'P2021' }) } }
    assert.deepEqual((await loadPurchase(() => true)).views, [])
    assert.equal(errs.length, 0)
    ;(stockPrisma as any).purchaseAllocation = { findMany: async () => { throw new Error('connection timeout') } }
    assert.deepEqual((await loadPurchase(() => true)).views, [])
    assert.match(String(errs[0][0]), /\[stock-allocation\] purchase allocations read failed/)
  } finally { console.error = orig }
})
