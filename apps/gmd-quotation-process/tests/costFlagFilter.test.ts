import test from 'node:test'
import assert from 'node:assert/strict'
import { itemCostFlag, COST_FLAG_CF_SET, COST_FLAG_CF_INCOMPLETE, COST_FLAG_ACT_PENDING } from '../lib/filterUtils.js'
import { buildItemWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'

const valve = { parentItemId: null, cfSetBreakdown: null, actuatorBreakdown: null, operationType: 'STANDARD', itemType: 'SLUICE VALVE' }
const cfOk = { ...valve, parentItemId: 'p', cfSetBreakdown: { missing: [] }, operationType: null, itemType: 'CF SET' }
const cfBad = { ...cfOk, cfSetBreakdown: { missing: ['CF_FLANGE_RATE MS'] } }
const actPending = { ...valve, operationType: 'ACT', actuatorBreakdown: { pending: ['bare valve cost'] } }
const actUnlinked = { ...valve, operationType: 'ACT' }
const actPriced = { ...valve, operationType: 'ACT', actuatorBreakdown: { pending: [] } }

test('cost chip filter passes everything when nothing is selected', () => {
  for (const it of [valve, cfOk, actPending]) assert.equal(itemCostFlag(it, []), true)
})

test('cost chip filter matches the chip shown under Cost', () => {
  assert.deepEqual([valve, cfOk, cfBad].map((it) => itemCostFlag(it, [COST_FLAG_CF_SET])), [false, true, true])
  assert.deepEqual([cfOk, cfBad].map((it) => itemCostFlag(it, [COST_FLAG_CF_INCOMPLETE])), [false, true])
  assert.deepEqual(
    [valve, actPending, actUnlinked, actPriced, cfBad].map((it) => itemCostFlag(it, [COST_FLAG_ACT_PENDING])),
    [false, true, true, false, false],
  )
  assert.equal(itemCostFlag(actPending, [COST_FLAG_CF_INCOMPLETE, COST_FLAG_ACT_PENDING]), true) // selections are OR-ed
})

test('cost chip filter reaches the SQL and facets can skip it', () => {
  const q = emptyEnquiryQuery()
  q.filters = { ...q.filters, costFlag: [COST_FLAG_CF_INCOMPLETE, COST_FLAG_ACT_PENDING] }
  const where = buildItemWhereSql(q).sql
  assert.match(where, /"cfSetBreakdown"->'missing'/)
  assert.match(where, /"actuatorBreakdown"->'pending'/)
  assert.equal(buildItemWhereSql(q, { skipField: 'costFlag' }).sql, 'TRUE')
})
