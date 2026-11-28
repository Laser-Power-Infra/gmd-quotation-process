import test from 'node:test'
import assert from 'node:assert/strict'
import { indexSaleContract, pickSaleContractFill, toContractDate } from '../lib/contractReviewSaleContract.js'

test('toContractDate normalises to dd-MMM-yyyy, day-first', () => {
  assert.equal(toContractDate('05-Nov-2025'), '05-Nov-2025')
  assert.equal(toContractDate('13/06/2025'), '13-Jun-2025')
  assert.equal(toContractDate('6.12.2024'), '06-Dec-2024')
  assert.equal(toContractDate('abc'), null)
  assert.equal(toContractDate(''), null)
})

test('indexSaleContract matches headers loosely and takes first usable value per contract', () => {
  const m = indexSaleContract([
    ['Contract No', 'PARTY REF NO', 'party_ref_date'],
    ['gd/1', '#N/A', '01/02/2025'],
    ['GD/1 ', 'PO-9', '09/09/2025'],
    ['', 'X', '01-Jan-2025'],
  ])
  assert.deepEqual(m.get('GD/1'), { poNo: 'PO-9', dateOfContract: '01-Feb-2025' })
  assert.equal(m.size, 1)
  assert.throws(() => indexSaleContract([['A', 'B']]), /header not found/)
})

test('pickSaleContractFill fills blanks only', () => {
  const sheet = { poNo: 'PO-1', dateOfContract: '01-Feb-2025' }
  assert.deepEqual(pickSaleContractFill({ poNo: null, dateOfContract: ' ' }, sheet), sheet)
  assert.deepEqual(pickSaleContractFill({ poNo: 'typed', dateOfContract: '02-Mar-2025' }, sheet), {})
  assert.deepEqual(pickSaleContractFill({ poNo: null }, undefined), {})
})
