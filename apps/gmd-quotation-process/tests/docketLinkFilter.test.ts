import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnquiryWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'
import filtersReducer, { initialFiltersState, setExactDocket, setFilter } from '../lib/filtersSlice.js'

const withFilters = (filters: Partial<typeof initialFiltersState>) => {
  const q = emptyEnquiryQuery()
  return { ...q, filters: { ...q.filters, ...filters } }
}

test('a DOCKET NO link matches its docket exactly, not every docket whose number contains it', () => {
  // Serials are not zero-padded, so a partial match on GMD/2026-27/42 also lists /420-/429.
  const where = buildEnquiryWhereSql(withFilters({ docketExact: 'GMD/2026-27/42' }))
  assert.match(where.sql, /e\."docketNumber" = \?/)
  assert.deepEqual(where.values, ['GMD/2026-27/42'])
})

test('the typed Docket no box stays a partial match', () => {
  const where = buildEnquiryWhereSql(withFilters({ docketNumber: '42' }))
  assert.match(where.sql, /ILIKE/)
  assert.doesNotMatch(where.sql, /"docketNumber" = /)
})

test('a link shows its docket in the Docket no box; typing there drops back to a partial match', () => {
  const linked = filtersReducer(initialFiltersState, setExactDocket('GMD/2026-27/42'))
  assert.equal(linked.docketExact, 'GMD/2026-27/42')
  assert.equal(linked.docketNumber, 'GMD/2026-27/42')

  const typed = filtersReducer(linked, setFilter({ field: 'docketNumber', value: 'GMD/2026-27/4' }))
  assert.equal(typed.docketExact, '')
  assert.equal(typed.docketNumber, 'GMD/2026-27/4')
})
