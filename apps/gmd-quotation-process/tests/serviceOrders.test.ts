import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceItemsFrom } from '../lib/serviceOrders.js'

// The page's joins and figures are SQL now: packages/service-orders/test/query.test.ts.

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
