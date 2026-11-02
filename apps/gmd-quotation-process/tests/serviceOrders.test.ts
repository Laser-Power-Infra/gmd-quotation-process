import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServiceOrders, serviceItemsFrom, sheetDay } from '../lib/serviceOrders.js'
import type { PoLine } from '../lib/serviceOrders.js'

const po = (o: Partial<PoLine>): PoLine => ({
  id: 'p', poNo: 'PE26Y-00001', poLineNo: '1', poDate: '01-10-2026', itemCode: 'SRV001', itemName: 'MACHINING',
  supplierCode: 'S1', supplierName: 'ACME', uom: 'NOS', netQtyOrder: '10', qtyExecuted: '4', balanceQty: '6',
  rate: '100', exchangeRate: '1', deliverySched: '2026-10-20', ...o,
})

test('service codes: LEVEL_1_NAME SERVICES or ITEM_NATURE SR, header row and duplicates skipped', () => {
  const headers = ['LEVEL_1_NAME', 'ITEM_CODE', 'ITEM_NAME', 'ITEM_NATURE']
  const items = serviceItemsFrom({ headers, rows: [
    headers,
    ['SERVICES', 'srv001', 'MACHINING', 'SR'],
    ['RAW MATERIAL', 'RM1', 'PLATE', 'RM'],
    ['OTHER', 'SRV002', 'PAINTING', 'sr'],
    ['SERVICES', 'SRV001', 'DUP', 'SR'],
  ] })
  assert.deepEqual(items, [{ itemCode: 'SRV001', itemName: 'MACHINING' }, { itemCode: 'SRV002', itemName: 'PAINTING' }])
  assert.throws(() => serviceItemsFrom({ headers: headers.slice(1), rows: [] }), /LEVEL_1_NAME/)
})

test('sheetDay reads DD-MM-YYYY and YYYY-MM-DD, nothing else', () => {
  assert.equal(sheetDay('05-10-2026')?.toISOString(), '2026-10-05T00:00:00.000Z')
  assert.equal(sheetDay('2026-10-20')?.toISOString(), '2026-10-20T00:00:00.000Z')
  assert.equal(sheetDay('08-14-2116'), null)
  assert.equal(sheetDay(null), null)
})

test('joins receipts on order no + line, computes pending, value, days and overdue', () => {
  const today = new Date(2026, 10, 2)
  const rows = buildServiceOrders(
    [po({}), po({ id: 'closed', poLineNo: '2', balanceQty: '0' }), po({ id: 'rm', itemCode: 'RM1' })],
    [
      { vrNo: 'GH1', vrDate: '05-10-2026', partyBillNo: 'B-1', orderVrNo: 'pe26y-00001', orderSlNo: '1' },
      { vrNo: 'GH2', vrDate: '15-10-2026', partyBillNo: 'B-2', orderVrNo: 'PE26Y-00001', orderSlNo: '1' },
      { vrNo: 'GH3', vrDate: '16-10-2026', partyBillNo: 'B-3', orderVrNo: 'PE26Y-00001', orderSlNo: '2' },
    ],
    new Set(['SRV001']),
    today,
  )
  assert.deepEqual(rows.map((r) => r.id), ['p', 'closed'])
  const [r] = rows
  assert.equal(r.pending, 6)
  assert.equal(r.pendingValue, 600)
  assert.equal(r.daysPending, 32)
  assert.equal(r.overdue, true)
  assert.equal(r.grnCount, 2)
  assert.equal(r.lastGrnNo, 'GH2')
  assert.equal(r.lastBillNo, 'B-2')
  assert.equal(rows[1].open, false)
  assert.equal(rows[1].daysPending, null)
  assert.equal(rows[1].overdue, false)
})
