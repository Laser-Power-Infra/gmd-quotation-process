import test from 'node:test'
import assert from 'node:assert/strict'
import { prodEntryQty, rateDiffPct } from '../lib/gmd_lib/contract-review-columns.js'
import { latestProdEntryDates, mailTagDay, prodEntryKey } from '../lib/contractReviewLinks.js'

test('PROD ENTRY QTY = prod order qty - balance to prod entry; blank when unknown, never negative', () => {
  assert.equal(prodEntryQty('10', '4'), 6)
  assert.equal(prodEntryQty('1,200', '200'), 1000)
  assert.equal(prodEntryQty('10', '0'), 10)
  assert.equal(prodEntryQty('10', '10'), 0) // nothing produced yet is a value, not a blank
  assert.equal(prodEntryQty('10', ''), null)
  assert.equal(prodEntryQty(null, '4'), null)
  assert.equal(prodEntryQty('abc', '1'), null)
  assert.equal(prodEntryQty('4', '10'), null)
})

test('RATE DIFF % = (contract rate - quoted rate) / quoted rate x 100; blank without both rates', () => {
  assert.equal(rateDiffPct(115, 100), 15)
  assert.equal(rateDiffPct('1,150', '1000.00'), 15)
  assert.equal(rateDiffPct('90', '120'), -25)
  assert.equal(rateDiffPct(null, 100), null)
  assert.equal(rateDiffPct(115, ''), null)
  assert.equal(rateDiffPct(115, 0), null)
})

const docs = JSON.stringify([
  { c: 'MC', u: 'https://mail.google.com/2', at: '2026-11-05T09:00:00.000Z' },
  // 01:30 on 21 Oct in India: the day is taken in IST, not UTC.
  { c: 'Drawing approval', u: 'https://mail.google.com/1', at: '2026-10-20T20:00:00.000Z' },
  { c: 'MC', u: 'https://mail.google.com/3', at: '2026-11-01T09:00:00.000Z' },
  { c: 'PO', u: 'https://mail.google.com/0', at: '2026-10-01T09:00:00.000Z' },
])

test('APPROVAL DATE: a blank cell takes the Drawing approval tag day; a value already there is kept', () => {
  assert.equal(mailTagDay(null, docs, 'Drawing approval'), '21-Oct-2026')
  assert.equal(mailTagDay(' ', docs, 'Drawing approval'), '21-Oct-2026')
  assert.equal(mailTagDay('15-Oct-2026', docs, 'Drawing approval'), null)
  assert.equal(mailTagDay(null, '[]', 'Drawing approval'), null)
  assert.equal(mailTagDay(null, 'not json', 'Drawing approval'), null)
})

test('MC DATE: same rule, from the first MC tag', () => {
  assert.equal(mailTagDay(null, docs, 'MC'), '01-Nov-2026')
  assert.equal(mailTagDay('03-Nov-2026', docs, 'MC'), null)
})

const IDX = { itemIdx: 0, dateIdx: 1, orderIdx: 2 } // PROD ENTRY DUMP: ITEM_CODE | VRDATE | ORDER_VRNO | QTYRECD

test('prod entries: the latest VRDATE per prod order + item wins, whatever the row order', () => {
  const { latest, skipped } = latestProdEntryDates({
    ...IDX,
    rows: [
      ['FCF090038', '03-01-2024', 'P123Y-00232', '23'],
      [' fcf090038', '15-02-2024', 'p123y-00232 ', '5'],
      ['FCF090038', '10-01-2024', 'P123Y-00232', '2'],
    ],
  })
  assert.equal(latest.get(prodEntryKey('P123Y-00232', 'FCF090038')), '15-Feb-2024')
  assert.equal(latest.size, 1)
  assert.equal(skipped, 0)
})

test('prod entries: another item or another prod order is never mixed in', () => {
  const { latest, skipped } = latestProdEntryDates({
    ...IDX,
    rows: [
      ['FCF090038', '03-01-2024', 'P123Y-00232', '23'],
      ['FCF090038', '20-03-2024', 'P123Y-00999', '1'],
      ['ABC000001', '25-03-2024', 'P123Y-00232', '1'],
    ],
  })
  assert.equal(latest.get(prodEntryKey('P123Y-00232', 'FCF090038')), '03-Jan-2024')
  assert.equal(latest.get(prodEntryKey('P123Y-00999', 'FCF090038')), '20-Mar-2024')
  assert.equal(latest.get(prodEntryKey('P123Y-00232', 'ABC000001')), '25-Mar-2024')
  assert.equal(skipped, 0)
})

test('prod entries: blank or garbage dates are ignored, and counted so a date-format change shows', () => {
  const { latest, skipped } = latestProdEntryDates({
    ...IDX,
    rows: [
      ['FCF090038', '03-01-2024', 'P123Y-00232', '23'],
      ['FCF090038', '', 'P123Y-00232', '5'],
      ['FCF090038', 'not a date', 'P123Y-00232', '5'],
      ['FCF090038', '45-13-2024', 'P123Y-00232', '5'],
      ['FCF090038', '45913', 'P123Y-00232', '5'],
      ['XYZ000001', '', 'P123Y-00232', '1'],
      ['', '05-01-2024', 'P123Y-00232', '1'],
    ],
  })
  assert.equal(latest.get(prodEntryKey('P123Y-00232', 'FCF090038')), '03-Jan-2024')
  assert.equal(latest.size, 1)
  assert.equal(skipped, 6)
})
