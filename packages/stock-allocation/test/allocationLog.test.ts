import test from 'node:test'
import assert from 'node:assert/strict'
import { logRow } from '../src/allocationLog'

// A ledger row as the ledger stores it (StockAllocation), before or after a write.
const booking = { erpCode: 'FSD040050', location: 'KGP', contractNo: 'C1', itemCode: 'FSD040050', qty: 5, source: 'manual', remarks: 'urgent' }
const locked = { erpCode: 'RAA010001', location: null, contractNo: 'C2', itemCode: 'FSD040051', qty: 2, source: 'locked', remarks: null }

test('addBooking: "book", no old qty, the booked qty as new', () => {
  assert.deepEqual(logRow('Puja Agarwal', null, booking), {
    by: 'Puja Agarwal', action: 'book', contractNo: 'C1', itemCode: 'FSD040050', erpCode: 'FSD040050', location: 'KGP',
    oldQty: null, newQty: 5, note: 'urgent',
  })
})

test('updateBooking: "change", old qty before the edit and new qty after it, the remarks it now has', () => {
  assert.deepEqual(logRow('Tridip', booking, { ...booking, qty: 3, remarks: 'part dispatched' }), {
    by: 'Tridip', action: 'change', contractNo: 'C1', itemCode: 'FSD040050', erpCode: 'FSD040050', location: 'KGP',
    oldQty: 5, newQty: 3, note: 'part dispatched',
  })
})

test('deleteBooking: "remove", the qty it held as old, no new qty', () => {
  assert.deepEqual(logRow('Tridip', booking, null), {
    by: 'Tridip', action: 'remove', contractNo: 'C1', itemCode: 'FSD040050', erpCode: 'FSD040050', location: 'KGP',
    oldQty: 5, newQty: null, note: 'urgent',
  })
})

test('lockOffer: "lock" per RM code locked; a lock it replaces or unlockOffer removes: "unlock"', () => {
  assert.deepEqual(logRow('puja@laser.com', null, locked), {
    by: 'puja@laser.com', action: 'lock', contractNo: 'C2', itemCode: 'FSD040051', erpCode: 'RAA010001', location: null,
    oldQty: null, newQty: 2, note: null,
  })
  assert.deepEqual(logRow('puja@laser.com', locked, null), {
    by: 'puja@laser.com', action: 'unlock', contractNo: 'C2', itemCode: 'FSD040051', erpCode: 'RAA010001', location: null,
    oldQty: 2, newQty: null, note: null,
  })
})

test('who: the name or email the host passes, trimmed; "unknown" only when it passes none', () => {
  assert.equal(logRow('  Tridip  ', null, booking).by, 'Tridip')
  for (const none of [null, undefined, '', '   ']) assert.equal(logRow(none, null, booking).by, 'unknown')
})
