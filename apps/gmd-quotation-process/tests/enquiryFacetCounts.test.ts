import test from 'node:test'
import assert from 'node:assert/strict'
import { facetCountSql, SIDEBAR_COUNT_FIELDS } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'

const withFilters = (filters: Record<string, string[]>) => {
  const q = emptyEnquiryQuery()
  return { ...q, filters: { ...q.filters, ...filters } }
}

test('every sidebar field has a count query and none is paged', () => {
  for (const field of SIDEBAR_COUNT_FIELDS) {
    const s = facetCountSql(emptyEnquiryQuery(), field)
    assert.ok(s, field)
    assert.doesNotMatch(s.sql, /LIMIT|OFFSET/)
    assert.match(s.sql, /GROUP BY 1/)
  }
})

test('state counts skip the state filter but keep the others', () => {
  const s = facetCountSql(withFilters({ state: ['Gujarat'], utility: ['PHED'] }), 'state')!
  assert.ok(!s.values.some((v) => JSON.stringify(v).includes('Gujarat')))
  assert.ok(s.values.some((v) => JSON.stringify(v).includes('PHED')))
})

test('item-level counts are distinct dockets', () => {
  const s = facetCountSql(emptyEnquiryQuery(), 'itemType')!
  assert.match(s.sql, /count\(DISTINCT e\.id\)/)
})

test('unknown field has no count query', () => {
  assert.equal(facetCountSql(emptyEnquiryQuery(), 'nope'), null)
})
