import test from 'node:test'
import assert from 'node:assert/strict'
import { GRN_HEADERS, buildServiceOrders, camel, mapGrnTab, serviceItemsFrom, sheetDay } from '../lib/serviceOrders.js'
import type { PoLine } from '../lib/serviceOrders.js'

const po = (o: Partial<PoLine>): PoLine => ({
  id: 'p', poNo: 'PE26Y-00001', poLineNo: '1', poDate: '01-10-2026', itemCode: 'SRV001', itemName: 'MACHINING',
  supplierCode: 'S1', supplierName: 'ACME', uom: 'NOS', netQtyOrder: '10', qtyExecuted: '4', balanceQty: '6',
  rate: '100', exchangeRate: '1', deliverySched: '2026-10-20', ...o,
})

test('camel-cases sheet headers', () => {
  assert.equal(camel('MAIN_POST_NAME'), 'mainPostName')
  assert.equal(camel('PARTYBILLNO'), 'partybillno')
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
})

test('GRN tab maps every header, drops blank VRNO, fails on a renamed column', () => {
  const headers = [...GRN_HEADERS]
  const row = ['SERVICE', 'S1', 'GH1', '05-10-2026', 'SRV001', 'B-9', '04-10-2026', 'PE26Y-00001', '1', '4', '400']
  const { records, skipped } = mapGrnTab({ headers, rows: [row, ['', '', '']] })
  assert.equal(skipped, 1)
  assert.equal(records[0].orderVrno, 'PE26Y-00001')
  assert.equal(records[0].qtyrecd, '4')
  assert.throws(() => mapGrnTab({ headers: headers.slice(1), rows: [] }), /MAIN_POST_NAME/)
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
      { vrno: 'GH1', vrdate: '05-10-2026', partybillno: 'B-1', orderVrno: 'pe26y-00001', orderSlno: '1' },
      { vrno: 'GH2', vrdate: '15-10-2026', partybillno: 'B-2', orderVrno: 'PE26Y-00001', orderSlno: '1' },
      { vrno: 'GH3', vrdate: '16-10-2026', partybillno: 'B-3', orderVrno: 'PE26Y-00001', orderSlno: '2' },
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
