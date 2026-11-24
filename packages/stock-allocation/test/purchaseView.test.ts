import test from 'node:test'
import assert from 'node:assert/strict'
import type { TableQuery } from '@gmd/ui/components/data-table/types'
import { allocationRows, friendlyPurchaseError, lotRows, purchaseViewFacet, purchaseViewPage, stateWords, type AllocationRowIn } from '../src/purchaseView'
import type { PurchaseLineView } from '../src/types'

const q = (o: Partial<TableQuery> = {}): TableQuery => ({ page: 1, pageSize: 50, sort: null, search: '', filters: {}, ...o })
const alloc = (o: Partial<AllocationRowIn> = {}): AllocationRowIn => ({
  id: 'a1', poNo: 'P1', poLineNo: '1', contractNo: 'C1', itemCode: 'FSD1', qty: 50, lot: 'LOT-7', tinaInvoiceNo: 'TI-9', blNo: 'BL-3',
  eta: '12-Dec-2026', needsConfirmation: false, remarks: null, source: 'manual', allocatedAt: '2026-11-01T00:00:00Z', ...o,
})
const view = (o: Partial<PurchaseLineView> = {}): PurchaseLineView => ({
  poNo: 'P1', poLineNo: '1', itemCode: 'RAA1', ordered: 100, received: 30, pending: 70,
  allocatedTo: [{ contractNo: 'C1', itemCode: 'FSD1', qty: 30, state: 'received' }, { contractNo: 'C1', itemCode: 'FSD1', qty: 20, state: 'incoming' }],
  freeBalance: 50, ...o,
})

test('state words: received, incoming and short, joined when a line is split', () => {
  assert.equal(stateWords({ physicalQty: 5, incomingQty: 0, shortQty: 0 }), 'received')
  assert.equal(stateWords({ physicalQty: 0, incomingQty: 4, shortQty: 0 }), 'incoming')
  assert.equal(stateWords({ physicalQty: 3, incomingQty: 0, shortQty: 2 }), 'received + short')
  assert.equal(stateWords({ physicalQty: 30, incomingQty: 20, shortQty: 0 }), 'received + incoming')
  assert.equal(stateWords({ physicalQty: 0, incomingQty: 0, shortQty: 0 }), '')
})

test('P2002 becomes the friendly text; capacity and other errors pass through unchanged', () => {
  const dup = friendlyPurchaseError(Object.assign(new Error('Unique constraint failed on the fields: (`poNo`,...)'), { code: 'P2002' }))
  assert.equal(dup.message, 'This contract line is already allocated from this purchase line: edit its qty instead')
  const cap = new Error('PO P1/1: only 10 free on this purchase line')
  assert.equal(friendlyPurchaseError(cap), cap)
  assert.equal(friendlyPurchaseError('boom').message, 'boom')
})

test('allocation rows: split qty, state words, shortage and the needs-confirmation badge text', () => {
  const [r, s] = allocationRows([
    alloc(),
    alloc({ id: 'a2', contractNo: 'C2', itemCode: 'FSD2', qty: 10, needsConfirmation: true, eta: 'soon' }),
  ], [view({ allocatedTo: [...view().allocatedTo, { contractNo: 'C2', itemCode: 'FSD2', qty: 10, state: 'short' }] })])
  assert.deepEqual([r.received, r.incoming, r.shortage, r.state, r.confirm, r.eta], [30, 20, 0, 'received + incoming', '', '2026-12-12'])
  assert.deepEqual([s.shortage, s.state, s.confirm, s.eta], [10, 'short', 'Needs confirmation', 'soon'])
})

test('allocation row with no engine view keeps a blank state, not a guess', () => {
  const [r] = allocationRows([alloc()], [])
  assert.deepEqual([r.state, r.received, r.shortage], ['', null, null])
})

test('lot rows: one per purchase line with lot / invoice / B/L / ETA, allocated-to and free balance', () => {
  const rows = lotRows([view(), view({ poLineNo: '2', allocatedTo: [], freeBalance: 100 })], [alloc(), alloc({ id: 'a2', contractNo: 'C9', lot: 'LOT-8', needsConfirmation: true })])
  assert.equal(rows.length, 2)
  const [a, b] = rows
  assert.deepEqual([a.purchaseLine, a.lot, a.tinaInvoiceNo, a.blNo, a.ordered, a.received, a.allocatedQty, a.freeBalance, a.confirm], ['P1/1', 'LOT-7; LOT-8', 'TI-9', 'BL-3', 100, 30, 50, 50, 'Needs confirmation'])
  assert.equal(a.allocatedTo, 'C1 / FSD1 ×50')
  assert.deepEqual([b.lot, b.allocatedTo, b.freeBalance], [null, '', 100])
})

test('lot page: search, filter, sort and paging run over every row on the server side; facets skip their own filter', () => {
  const views = ['3', '1', '2', '10'].map((n) => view({ poLineNo: n, freeBalance: Number(n) }))
  const rows = lotRows(views, [])
  assert.deepEqual(purchaseViewPage('lots', rows, q()).rows.map((r) => (r as { poLineNo: string }).poLineNo), ['1', '2', '3', '10'])
  const sorted = purchaseViewPage('lots', rows, q({ sort: { key: 'freeBalance', dir: 'desc' }, page: 2, pageSize: 2 }))
  assert.deepEqual(sorted.rows.map((r) => (r as { poLineNo: string }).poLineNo), ['2', '1'])
  assert.equal(sorted.total, 4)
  assert.equal(purchaseViewPage('lots', rows, q({ search: 'P1/3' })).total, 1)
  // unknown sort key / filter key are ignored, page size capped
  assert.equal(purchaseViewPage('lots', rows, q({ sort: { key: 'id', dir: 'asc' }, filters: { nope: ['x'] } })).total, 4)
  assert.equal(purchaseViewPage('lots', rows, q({ pageSize: 5000 })).rows.length, 4)
  assert.deepEqual(purchaseViewFacet('lots', rows, 'purchaseLine', q({ filters: { purchaseLine: ['P1/1'] } })), ['P1/1', 'P1/10', 'P1/2', 'P1/3'])
  assert.deepEqual(purchaseViewFacet('lots', rows, 'freeBalance', q()), [])
})
