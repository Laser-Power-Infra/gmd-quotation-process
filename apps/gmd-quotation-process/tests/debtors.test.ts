import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDebtorTotals, filterDebtors } from '../lib/debtors.js'
import type { DebtorRow } from '../lib/debtors.js'

function makeRow(overrides: Partial<DebtorRow> = {}): DebtorRow {
  return {
    id: 'id-1',
    accSch: null,
    accCode: 'ACC-001',
    accName: 'Acme Traders',
    tCode: null,
    vrNo: 'VR-100',
    vrDate: null,
    dueDate: null,
    particular: 'Invoice for Q1',
    drAmt: 1000,
    drAllocAmt: 400,
    unAllocDr: 600,
    unAllocCr: 0,
    partyBillNo: 'PB-999',
    partyBillDate: null,
    ...overrides,
  }
}

test('computeDebtorTotals returns zeros for an empty list', () => {
  assert.deepEqual(computeDebtorTotals([]), {
    drAmt: 0,
    drAllocAmt: 0,
    unAllocDr: 0,
    unAllocCr: 0,
  })
})

test('computeDebtorTotals sums the four money columns, treating null as zero', () => {
  const totals = computeDebtorTotals([
    { drAmt: 1000, drAllocAmt: 400, unAllocDr: 600, unAllocCr: 0 },
    { drAmt: 250.5, drAllocAmt: null, unAllocDr: null, unAllocCr: 75 },
    { drAmt: null, drAllocAmt: null, unAllocDr: null, unAllocCr: null },
  ])
  assert.deepEqual(totals, {
    drAmt: 1250.5,
    drAllocAmt: 400,
    unAllocDr: 600,
    unAllocCr: 75,
  })
})

test('filterDebtors returns every row for a blank query', () => {
  const rows = [makeRow(), makeRow({ id: 'id-2', accCode: 'ACC-002' })]
  assert.equal(filterDebtors(rows, '').length, 2)
  assert.equal(filterDebtors(rows, '   ').length, 2)
})

test('filterDebtors matches accCode, accName, vrNo, partyBillNo and particular', () => {
  const rows = [
    makeRow({ id: 'a', accCode: 'ACC-101', accName: 'Alpha', vrNo: 'VR-1', partyBillNo: 'PB-1', particular: 'Alpha invoice' }),
    makeRow({ id: 'b', accCode: 'ACC-202', accName: 'Beta', vrNo: 'VR-2', partyBillNo: 'PB-2', particular: 'Beta invoice' }),
  ]

  assert.deepEqual(filterDebtors(rows, 'acc-101').map((r) => r.id), ['a'])
  assert.deepEqual(filterDebtors(rows, 'beta').map((r) => r.id), ['b'])
  assert.deepEqual(filterDebtors(rows, 'vr-1').map((r) => r.id), ['a'])
  assert.deepEqual(filterDebtors(rows, 'pb-2').map((r) => r.id), ['b'])
  assert.deepEqual(filterDebtors(rows, 'alpha invoice').map((r) => r.id), ['a'])
})

test('filterDebtors is case-insensitive and returns empty on no match', () => {
  const rows = [makeRow({ accName: 'Acme Traders' })]
  assert.equal(filterDebtors(rows, 'ACME').length, 1)
  assert.equal(filterDebtors(rows, 'missing').length, 0)
})

test('filterDebtors ignores null searchable fields', () => {
  const rows = [makeRow({ accName: null, vrNo: null, partyBillNo: null, particular: null })]
  assert.equal(filterDebtors(rows, 'ACC-001').length, 1)
})
