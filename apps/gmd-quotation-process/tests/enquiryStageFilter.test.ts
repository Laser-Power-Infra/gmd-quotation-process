import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnquiryWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'

test('no stage adds no stage predicate', () => {
  const where = buildEnquiryWhereSql(emptyEnquiryQuery())
  assert.equal(where.sql, 'TRUE')
})

test('a stage tile filters on the stage CASE', () => {
  const where = buildEnquiryWhereSql({ ...emptyEnquiryQuery(), stage: 'cost' })
  assert.match(where.sql, /CASE/)
  assert.ok(where.values.includes('cost'))
})

test('tile counts skip the stage filter', () => {
  const where = buildEnquiryWhereSql({ ...emptyEnquiryQuery(), stage: 'cost' }, { skipField: 'stage' })
  assert.equal(where.sql, 'TRUE')
})
