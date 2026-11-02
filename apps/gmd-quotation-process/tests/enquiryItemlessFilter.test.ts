import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnquiryWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'

const ITEM_EXISTS = /EXISTS \(SELECT 1 FROM "EnquiryItem"/

const withFilters = (patch: Record<string, unknown>) => {
  const base = emptyEnquiryQuery()
  return { ...base, filters: { ...base.filters, ...patch } }
}

// A docket auto-created from an email has no items until someone adds them.
// Requiring a matching item made every enquiry-level filter hide those dockets:
// searching their docket number returned nothing at all.
test('an enquiry-level filter does not require the docket to have items', () => {
  for (const patch of [
    { docketNumber: 'GEM/2026/B/8194582' },
    { partyNames: ['ACME'] },
    { enquiryDateFrom: '2026-10-01' },
    { closureStatus: ['OPEN'] },
  ]) {
    const where = buildEnquiryWhereSql(withFilters(patch))
    assert.doesNotMatch(
      where.sql,
      ITEM_EXISTS,
      `${Object.keys(patch)[0]} must not add an item-exists requirement`,
    )
  }
})

test('an item-level filter still requires a matching item', () => {
  for (const patch of [
    { itemName: 'gate valve' },
    { itemType: ['SLUICE VALVE'] },
    { vaPercent: ['10'] },
  ]) {
    const where = buildEnquiryWhereSql(withFilters(patch))
    assert.match(
      where.sql,
      ITEM_EXISTS,
      `${Object.keys(patch)[0]} must still match against items`,
    )
  }
})

test('the item-only toggles still require a matching item', () => {
  for (const key of ['closedBomOnly', 'incompleteOnly', 'costWarningOnly'] as const) {
    const where = buildEnquiryWhereSql({ ...emptyEnquiryQuery(), [key]: true })
    assert.match(where.sql, ITEM_EXISTS, `${key} must still match against items`)
  }
})

// fetchEnquiryFacet builds an enquiry-level facet from buildEnquiryWhereSql alone,
// with the facet's own field skipped so the dropdown can cascade. It used to add its
// own item-exists clause on top, which hid every item-less docket's party and state
// from the filter dropdowns. These pin the behaviour it now depends on.
test('an enquiry-level facet does not require the docket to have items', () => {
  const where = buildEnquiryWhereSql(withFilters({ partyNames: ['ACME'] }), {
    skipField: 'partyNames',
  })
  assert.doesNotMatch(where.sql, ITEM_EXISTS)
})

test('an enquiry-level facet still narrows when an item filter is set', () => {
  const where = buildEnquiryWhereSql(withFilters({ itemName: 'valve' }), {
    skipField: 'partyNames',
  })
  assert.match(where.sql, ITEM_EXISTS)
})

test('an enquiry-level filter still filters on the enquiry column', () => {
  const where = buildEnquiryWhereSql(withFilters({ docketNumber: 'GEM/2026/B/8194582' }))
  assert.match(where.sql, /docketNumber/)
  assert.ok(where.values.some((v) => String(v).includes('gem/2026/b/8194582')))
})
