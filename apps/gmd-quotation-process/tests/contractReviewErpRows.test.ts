import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContractReviewErpRows, type ErpTab } from '../lib/gmd_lib/contract-review-erp-rows.js'

const tab = (tabTitle: string, headers: string[], ...rows: string[][]): ErpTab => ({ tabTitle, headers, rows })

const SC = ['VRNO', 'VRDATE', 'ACC_CODE', 'ITEM_CODE', 'PARTY_ITEM_NAME', 'RATE', 'PARTYREFNO', 'PARTYREFDATE', 'QTYORDER', 'QTYCANCELLED', 'NET_ORDER_VALUE', 'SLNO', 'MC NO']
const line = (vr: string, item: string, rate: string, qty: string, cancelled: string, sl: string, mc: string) =>
  [vr, '01-01-2026', 'ACC1', item, 'party item', rate, '', '', qty, cancelled, '', sl, mc]

const tabs = {
  saleContract: tab('SALE CONTRACT', SC,
    SC, // the tab repeats its header on row 2
    line('SD1', 'ITEMA', '1,000.50', '10', '2', '1', 'OD1'), // two MCs, cancelled qty
    line('SD2', 'ITEMB', '100', '12', '0', '1', 'OD3'), // same item on two lines
    line('SD2', 'ITEMB', '50', '1', '0', '2', 'OD3'),
    line('SD3', 'ITEMC', '10', '5', '0', '1', ''), // no MC yet
  ),
  mc: tab('MC', ['', 'VRNO', 'SLNO', 'CONTRACT_VRNO', 'ITEM_CODE', 'QTYORDER', 'QTYCANCELLED', 'CONTRACT_SLNO'],
    ['', 'OD1', '1', 'SD1', 'ITEMA', '5', '0', '1'],
    ['', 'OD2', '1', 'SD1', 'ITEMA', '4', '1', '1'],
    ['', 'OD3', '1', 'SD2', 'ITEMB', '12', '0', '1'],
    ['', 'OD3', '2', 'SD2', 'ITEMB', '1', '0', '2'],
  ),
  prodOrder: tab('PROD ORDER DUMP', ['CONTRACT_VRNO', 'VRNO', 'VRDATE', 'ITEM_CODE', 'NET_QTYORDER', 'BOM_ID'],
    ['OD1', 'P1', '', 'ITEMA', '5', ''],
    ['OD2', 'P2', '', 'ITEMA', '2', ''],
    ['OD3', 'P3', '', 'ITEMB', '13', ''],
  ),
  prodEntry: tab('PROD ENTRY DUMP', ['ITEM_CODE', 'VRDATE', 'ORDER_VRNO', 'QTYRECD'],
    ['ITEMA', '', 'P1', '3'],
    ['ITEMA', '', 'P2', '1'],
    ['ITEMB', '', 'P3', '13'],
  ),
  inspectionOffer: tab('INSPECTION OFFER DUMP', ['VRNO', 'ITEM_CODE', 'CONTRACT_VRNO', 'IC_QTY', 'DI_QTY', 'DI_QTYCANCELLED'],
    ['IO1', 'ITEMA', 'OD1', '4', '3', '1'],
    ['IO2', 'ITEMB', 'OD3', '13', '13', '0'],
  ),
  saleBill: tab('SALE BILL', ['VRNO', 'QTYISSUED', 'ORDER_VRNO', 'ITEM_CODE'],
    ['B1', '2', 'OD1', 'ITEMA'],
    ['B2', '13', 'OD3', 'ITEMB'],
  ),
}

const rows = buildContractReviewErpRows(tabs, new Map([['ACC1', 'Party One']]))

test('one row per contract + item, header repeat skipped', () => {
  assert.deepEqual([...rows.keys()].sort(), ['ITEMA||SD1', 'ITEMB||SD2', 'ITEMC||SD3'])
})

test('line with two MCs: quantities summed across both, cancelled qty removed', () => {
  assert.deepEqual(rows.get('ITEMA||SD1'), {
    contractNo: 'SD1', itemCode: 'ITEMA', mcNo: 'OD1', jobCode: 'OD1',
    partyNameDump: 'Party One', partyItemName: 'party item', rate: '1,000.50',
    orderQty: '8', mcQty: '8', balanceMc: '0',
    prodOrdQty: '7', balanceToProdOrd: '1', balanceToProdEnt: '3',
    diQty: '2', billedQty: '2', balBillAgMc: '6', balBillAgCont: '6', balDiQty: '6',
    balMcVal: '0', balProdOrdVal: '1000.5', balToProdOrdEntVal: '3001.5',
    balBillAgMcVal: '6003', balBillAgContVal: '6003', balDiVal: '6003', diVal: '2001',
    icQty: '4',
  })
})

test('item repeated on two lines: merged, downstream qty counted once, first rate kept', () => {
  const r = rows.get('ITEMB||SD2')!
  assert.equal(r.orderQty, '13')
  assert.equal(r.mcQty, '13')
  assert.equal(r.prodOrdQty, '13')
  assert.equal(r.billedQty, '13')
  assert.equal(r.rate, '100')
  assert.equal(r.balBillAgCont, '0')
})

test('no MC yet: MC no blank, everything still to do', () => {
  const r = rows.get('ITEMC||SD3')!
  assert.equal(r.mcNo, null)
  assert.equal(r.mcQty, '0')
  assert.equal(r.balanceMc, '5')
  assert.equal(r.balMcVal, '50')
})

test('a missing ERP column fails loudly', () => {
  assert.throws(
    () => buildContractReviewErpRows({ ...tabs, saleBill: tab('SALE BILL', ['VRNO']) }, new Map()),
    /SALE BILL.*ORDER_VRNO/,
  )
})
