import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLots, type Matched } from '../lib/chinaLotLoad.js'

const m = (qty: number, lot = '135 LOT'): Matched => ({
  poNo: 'P1', poLineNo: '1', row: { contractNo: 'SD1', itemCode: 'FSD1', size: '', qty, qtyRaw: String(qty), lot, tinaInvoiceNo: '', blStatus: '', needsConfirmation: false },
})
class Dup extends Error {}
const isDup = (e: unknown) => e instanceof Dup

test('re-run: rows already booked with the same qty are "already loaded", nothing is added, no failure', async () => {
  const added: Matched[] = []
  const r = await applyLots([m(30)], [{ poNo: 'P1', poLineNo: '1', contractNo: 'sd1', itemCode: 'fsd1', qty: 30 }], async (x) => { added.push(x) }, isDup)
  assert.deepEqual([r.loaded, r.alreadyLoaded, r.conflicts.length, r.failed.length, added.length], [0, 1, 0, 0, 0])
})

test('two lots on the same PO line + contract + item: the second is a conflict line, not dropped as already loaded', async () => {
  const added: Matched[] = []
  const r = await applyLots([m(30, '135 LOT'), m(20, '136 LOT')], [], async (x) => { added.push(x) }, isDup)
  assert.deepEqual([r.loaded, r.alreadyLoaded, added.length], [1, 0, 1])
  assert.equal(r.conflicts.length, 1)
  assert.match(r.conflicts[0], /136 LOT qty 20 but 30 is already booked/)
})

test('typed duplicate error from the ledger counts as already loaded; other errors fail', async () => {
  const r1 = await applyLots([m(30)], [], async () => { throw new Dup() }, isDup)
  assert.deepEqual([r1.alreadyLoaded, r1.failed.length], [1, 0])
  const r2 = await applyLots([m(30)], [], async () => { throw new Error('only 0 free') }, isDup)
  assert.deepEqual([r2.alreadyLoaded, r2.failed.length], [0, 1])
})
