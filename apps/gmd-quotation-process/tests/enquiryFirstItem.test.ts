import test from 'node:test'
import assert from 'node:assert/strict'
import { firstItemIdsSql, itemCountsSql, summaryTotalsSql, buildEnquiryWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'

const q = () => {
  const e = emptyEnquiryQuery()
  return { ...e, filters: { ...e.filters, itemType: ['Gate Valve'] } }
}

test('first item per docket is DISTINCT ON, ordered by position, with the item filter', () => {
  const s = firstItemIdsSql(q(), ['a', 'b'])
  assert.match(s.sql, /DISTINCT ON \(i\."enquiryId"\)/)
  assert.match(s.sql, /ORDER BY i\."enquiryId", i\."position" ASC/)
  assert.ok(s.values.some((v) => JSON.stringify(v).includes('Gate Valve')))
  assert.ok(s.values.some((v) => JSON.stringify(v).includes('a')))
})

test('item counts: matching count uses the filter, incomplete count does not', () => {
  const s = itemCountsSql(q(), ['a'])
  assert.match(s.sql, /"itemCount"/)
  assert.match(s.sql, /"incompleteItemCount"/)
  assert.match(s.sql, /GROUP BY i\."enquiryId"/)
  assert.ok(s.values.some((v) => JSON.stringify(v).includes('Gate Valve')))
})

test('summary totals are one aggregate with the numeric guard and the same exclusions', () => {
  const s = summaryTotalsSql(q(), buildEnquiryWhereSql(q()))
  assert.match(s.sql, /count\(\*\)::int AS items/)
  assert.equal((s.sql.match(/sum\(/g) ?? []).length, 4)
  assert.match(s.sql, /\^-\?\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$/)
  assert.match(s.sql, /i\."cost" > 0/)
  assert.match(s.sql, /i\."quantity" > 0 THEN i\."quantity" ELSE 1/)
  assert.match(s.sql, /"cBatch"/)
  assert.match(s.sql, /"nBatch"/)
  assert.match(s.sql, /"duplicate"/)
  assert.ok(s.values.some((v) => JSON.stringify(v).includes('Gate Valve')))
})
