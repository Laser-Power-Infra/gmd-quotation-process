import test from 'node:test'
import assert from 'node:assert/strict'
import { stockPrisma } from '@gmd/db-stock'
import { prisma as tenderPrisma } from '@gmd/db-tender'
import { addPurchaseAllocation, deletePurchaseAllocation, updatePurchaseAllocation, DuplicatePurchaseAllocationError } from '../src/server/purchaseLedger'

// stockPrisma / tenderPrisma mocked: an in-memory tx records calls in order; nothing touches a database.
function mock(ordered: string | null, allocated: number, line: object | null = { netQtyOrder: ordered, itemCode: 'RAA010001' }, live = true) {
  const writes: { op: string; data: any }[] = []
  const lookups: any[] = []
  ;(tenderPrisma as any).contractReview = { findFirst: async (a: any) => (lookups.push(a), live ? { id: 1 } : null) }
  const tx: any = {
    $executeRaw: async (strings: any, ...vals: any[]) => (writes.push({ op: 'lock', data: { sql: strings.join('?'), vals } }), 1),
    purchaseOrderLine: { findFirst: async () => (writes.push({ op: 'readLine', data: null }), line) },
    purchaseAllocation: {
      aggregate: async () => (writes.push({ op: 'sum', data: null }), { _sum: { qty: allocated } }),
      create: async ({ data }: any) => (writes.push({ op: 'create', data }), { id: 'a1', ...data }),
      update: async ({ data }: any) => (writes.push({ op: 'update', data }), { id: 'a1', poNo: 'P1', poLineNo: '1', contractNo: 'C1', itemCode: 'FSD1', ...data }),
      findUniqueOrThrow: async () => ({ id: 'a1', poNo: 'P1', poLineNo: '1', contractNo: 'C1', itemCode: 'FSD1', qty: 30, remarks: null }),
      delete: async () => (writes.push({ op: 'delete', data: null }), {}),
    },
    stockAllocationLog: { create: async ({ data }: any) => (writes.push({ op: 'log', data }), data) },
  }
  ;(stockPrisma as any).$transaction = async (fn: any) => fn(tx)
  return Object.assign(writes, { lookups })
}
const input = { poNo: 'P1', poLineNo: '1', contractNo: 'C1', itemCode: 'FSD1', qty: 20, source: 'manual' as const }
const written = (w: { op: string }[]) => w.map((x) => x.op).filter((o) => !['lock', 'readLine', 'sum'].includes(o))

test('add over the free qty throws the capacity text and writes nothing', async () => {
  const writes = mock('100', 90)
  await assert.rejects(addPurchaseAllocation(input, 'Puja'), /only 10 free on this purchase line/)
  assert.deepEqual(written(writes), [])
})

test('valid add writes the row and one log row', async () => {
  const writes = mock('100', 70)
  const row = await addPurchaseAllocation(input, 'Puja')
  assert.equal(row.qty, 20)
  assert.deepEqual(writes.map((w) => w.op), ['lock', 'readLine', 'sum', 'create', 'log'])
  assert.deepEqual(writes[4].data, {
    by: 'Puja', action: 'book', contractNo: 'C1', itemCode: 'FSD1', erpCode: 'RAA010001', location: null,
    oldQty: null, newQty: 20, note: 'PO P1/1',
  })
})

test('missing purchase line or blank ordered qty is a clear error', async () => {
  mock('100', 0, null)
  await assert.rejects(addPurchaseAllocation(input, 'Puja'), /PO P1\/1 not found/)
  mock(null, 0)
  await assert.rejects(addPurchaseAllocation(input, 'Puja'), /no ordered qty/)
})

test('delete logs remove with the old qty', async () => {
  const writes = mock('100', 30)
  await deletePurchaseAllocation('a1', 'Puja')
  assert.deepEqual(writes.map((w) => w.op), ['readLine', 'delete', 'log'])
  const log = writes[2].data
  assert.equal(log.action, 'remove')
  assert.equal(log.oldQty, 30)
  assert.equal(log.newQty, null)
})

test('adding the same contract line twice says to edit its qty, as the typed error', async () => {
  mock('100', 0)
  ;(stockPrisma as any).$transaction = async () => { throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) }
  await assert.rejects(addPurchaseAllocation(input, 'Puja'), (e: any) =>
    e instanceof DuplicatePurchaseAllocationError && /already allocated from this purchase line: edit its qty instead/.test(e.message))
})

test('add takes the per-purchase-line advisory lock, parameterised, before reading the sum', async () => {
  const writes = mock('100', 0)
  await addPurchaseAllocation(input, 'Puja')
  const ops = writes.map((w) => w.op)
  assert.equal(ops[0], 'lock')
  assert.ok(ops.indexOf('lock') < ops.indexOf('sum'))
  assert.match(writes[0].data.sql, /pg_advisory_xact_lock\(hashtext\(\?\)\)/)
  assert.deepEqual(writes[0].data.vals, ['P1|1'])
})

test('update takes the lock before reading the sum', async () => {
  const writes = mock('100', 0)
  await updatePurchaseAllocation('a1', { qty: 10 }, 'Puja')
  const ops = writes.map((w) => w.op)
  assert.ok(ops.indexOf('lock') >= 0 && ops.indexOf('lock') < ops.indexOf('sum'))
  assert.deepEqual(writes[0].data.vals, ['P1|1'])
})

test('add for a contract + item that is not a live contract line is rejected, nothing written', async () => {
  const writes = mock('100', 0, undefined, false)
  await assert.rejects(addPurchaseAllocation(input, 'Puja'), /No live contract line C1 \/ FSD1/)
  assert.equal(writes.length, 0)
})

test('add looks the contract line up with the live definition', async () => {
  const writes = mock('100', 0)
  await addPurchaseAllocation(input, 'Puja')
  const w = writes.lookups[0].where
  assert.equal(w.clearanceStatus, 'APPROVED')
  assert.deepEqual(w.OR, [{ status: null }, { status: '' }])
  assert.deepEqual(w.mcReceivedPending, { in: ['Received', 'Pending'], mode: 'insensitive' })
})
