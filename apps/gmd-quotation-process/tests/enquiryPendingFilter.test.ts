import test from 'node:test'
import assert from 'node:assert/strict'
import { initialFiltersState } from '../lib/filtersSlice.js'
import { hasActiveItemFilters } from '../lib/enquiryFilterScope.js'

const filters = { ...initialFiltersState }

test('no filters means no item requirement', () => {
  assert.equal(hasActiveItemFilters(filters), false)
})

test('enquiry-level filters do not hide a zero-item pending docket', () => {
  assert.equal(hasActiveItemFilters({ ...filters, docketNumber: 'GMD/2026-27/400' }), false)
  assert.equal(hasActiveItemFilters({ ...filters, partyNames: ['ACME'] }), false)
  assert.equal(hasActiveItemFilters({ ...filters, enquiryType: ['ENQUIRY'] }), false)
  assert.equal(hasActiveItemFilters({ ...filters, closureStatus: ['OPEN'] }), false)
  assert.equal(hasActiveItemFilters({ ...filters, enquiryDateFrom: '2026-10-01' }), false)
  assert.equal(hasActiveItemFilters({ ...filters, attachment: 'pdf' }), false)
  assert.equal(hasActiveItemFilters({ ...filters, contractNo: ['C-1'] }), false)
  assert.equal(hasActiveItemFilters({ ...filters, globalSearch: 'GMD' }), false)
})

test('item-level filters require a matching item', () => {
  assert.equal(hasActiveItemFilters({ ...filters, itemName: 'gate valve' }), true)
  assert.equal(hasActiveItemFilters({ ...filters, itemType: ['SLUICE VALVE'] }), true)
  assert.equal(hasActiveItemFilters({ ...filters, vaPercent: ['10'] }), true)
  assert.equal(hasActiveItemFilters({ ...filters, image: ['Present'] }), true)
  assert.equal(hasActiveItemFilters({ ...filters, deletedStatus: ['Deleted as Closed'] }), true)
  assert.equal(hasActiveItemFilters({ ...filters, pdcostValidation: ['5%'] }), true)
})

test('the closed-BOM toggle is an item filter', () => {
  assert.equal(hasActiveItemFilters(filters, true), true)
})
