import test from 'node:test'
import assert from 'node:assert/strict'
import { erpStockByCode } from '../schedular_function/physical-stock-erp-stock.js'

const headers = ['LEVEL_1_NAME', 'ITEM_CODE', 'ITEM_NAME', 'UM', 'STOCK']

test('erpStockByCode maps ITEM_CODE to STOCK, skipping the repeated header, blanks and duplicates', () => {
  const map = erpStockByCode({
    headers,
    rows: [
      ['LEVEL_1_NAME', 'ITEM_CODE', 'ITEM_NAME', 'UM', '0.00'],
      ['CAPITALS', ' cga010001 ', 'DISPENSER', 'PCS', '1.00'],
      ['CAPITALS', 'CGA010001', 'DISPENSER', 'PCS', '9.00'],
      ['CAPITALS', 'CGB010001', 'LATHE', 'NO', ''],
      ['CAPITALS', 'CGB010002', 'DRILL', 'NO', '0.00'],
      ['CAPITALS', '', 'NO CODE', 'NO', '5.00'],
    ],
  })
  assert.deepEqual([...map], [['CGA010001', '1.00'], ['CGB010002', '0.00']])
})

test('erpStockByCode throws when the STOCK column is renamed', () => {
  assert.throws(() => erpStockByCode({ headers: ['ITEM_CODE', 'QTY'], rows: [] }), /STOCK/)
})
