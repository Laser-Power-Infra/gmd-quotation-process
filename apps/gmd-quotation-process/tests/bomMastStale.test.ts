import test from 'node:test'
import assert from 'node:assert/strict'
import { erpQtyUpdate, staleBomItemIds } from '../lib/bomMastStale.js'

test('erpQty follows QTYUNIT, and a missing QTYUNIT column wipes nothing', () => {
  assert.equal(erpQtyUpdate(null, 2.5), 2.5)
  assert.equal(erpQtyUpdate('2.5', 2.5), undefined) // unchanged (Prisma Decimal reads back via Number)
  assert.equal(erpQtyUpdate('2.5', null), null) // a blank cell on a present column clears it
  assert.equal(erpQtyUpdate('2.5', undefined), undefined) // renamed or dropped column: left alone
})

test('staleBomItemIds unlinks unbacked links, keeps manual and NEW-BOM drafts', () => {
  const items = [
    { id: 'backed', key: 'b1||r:rm1', bomCode: 'BOM-1', manualLink: false },
    { id: 'stale-in-sheet', key: 'b1||r:rm2', bomCode: 'BOM-1', manualLink: false },
    { id: 'missing-bom', key: 'b9||r:rm3', bomCode: 'BOM-9', manualLink: false },
    { id: 'manual', key: 'b9||r:rm4', bomCode: 'BOM-9', manualLink: true },
    { id: 'draft', key: 'b8||r:rm5', bomCode: 'NEW-BOM-0001', manualLink: false },
  ]
  assert.deepEqual(staleBomItemIds(items, new Set(['b1||r:rm1'])), [
    'stale-in-sheet',
    'missing-bom',
  ])
})
