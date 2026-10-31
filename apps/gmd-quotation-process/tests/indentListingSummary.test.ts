import test from 'node:test'
import assert from 'node:assert/strict'
import { isShortageRow, summarizeIndentRows } from '../lib/indentListingSummary.js'
import type { VariantMetrics } from '../lib/indentListingMetrics.js'

const m = (stock: string | null): VariantMetrics => ({
  mcReceived: null,
  mcPending: null,
  stock,
  orderedQty: null,
  pendingOrderQty: null,
})

// item, size, pn, status, total, v1..v4, ...
const row = (status: string, v: (string | null)[]): unknown[] => ['SLV', '100', 'PN-10', status, '0', ...v]

test('shortage when a variant balance exceeds its stock', () => {
  assert.equal(isShortageRow(row('Pending', ['10', null, null, null]), [m('4')]), true)
  assert.equal(isShortageRow(row('Pending', ['10', null, null, null]), [m('10')]), false)
  // V2 short while V1 is covered.
  assert.equal(isShortageRow(row('Pending', ['1', '5', null, null]), [m('9'), m('2')]), true)
})

test('blank stock counts as 0; empty balance is not a shortage', () => {
  assert.equal(isShortageRow(row('Pending', ['10', null, null, null]), [m(null)]), true)
  assert.equal(isShortageRow(row('Pending', ['10', null, null, null]), undefined), true)
  assert.equal(isShortageRow(row('Pending', ['', '0', null, null]), [m('0'), m('0')]), false)
})

test('summary counts rows by status and shortage', () => {
  const rows = [
    row('Received', ['5', null, null, null]),
    row('received ', ['1', null, null, null]),
    row('Pending', ['8', null, null, null]),
    row('', [null, null, null, null]),
  ]
  const metrics = new Map<unknown[], VariantMetrics[]>([
    [rows[0], [m('2')]],
    [rows[1], [m('2')]],
    [rows[2], [m('3')]],
  ])
  assert.deepEqual(summarizeIndentRows(rows, (r) => metrics.get(r)), {
    total: 4,
    received: 2,
    pending: 1,
    shortage: 2,
  })
})
