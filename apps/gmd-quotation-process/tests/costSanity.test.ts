import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnquiryWhereSql, buildItemWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery } from '../lib/enquiryQuery.js'
import { COST_WARNING, evaluateCostWarnings, type CostItem } from '../lib/costSanity.js'

// The SQL is the source of truth; evaluateCostWarnings mirrors it so the rules can be tested without a DB.

test('cost warning filter is off by default', () => {
  assert.equal(buildItemWhereSql(emptyEnquiryQuery()).sql, 'TRUE')
  assert.equal(buildEnquiryWhereSql(emptyEnquiryQuery()).sql, 'TRUE')
})

test('cost warning filter adds the rules and requires a matching item', () => {
  const q = { ...emptyEnquiryQuery(), costWarningOnly: true }
  const item = buildItemWhereSql(q)
  for (const label of Object.values(COST_WARNING)) assert.ok(item.values.includes(label), label)
  assert.match(item.sql, /cardinality\(array_remove/)
  assert.match(buildEnquiryWhereSql(q).sql, /EXISTS \(SELECT 1 FROM "EnquiryItem" i/)
})

test('facets can skip the cost warning filter', () => {
  const q = { ...emptyEnquiryQuery(), costWarningOnly: true }
  assert.equal(buildItemWhereSql(q, { skipField: 'costWarningOnly' }).sql, 'TRUE')
})

const base = { enquiryId: 'e', itemType: 'SLUICE', moc: 'CI', pnRating: 'PN10', operationType: 'HW' }
const mk = (id: string, size: string, productCost: number, extra: Partial<CostItem> = {}): CostItem =>
  ({ ...base, id, size, productCost, ...extra })

test('docket 087: DN50 and DN150 flagged by size, negative VA flagged', () => {
  const w = evaluateCostWarnings([
    mk('a', 'DN50', 4142, { vaPercent: '-42%' }),
    mk('b', 'DN150', 4816, { vaPercent: '-8%' }),
    mk('c', 'DN200', 13354),
  ])
  assert.equal(w.get('a')?.[0], 'DN50 costs ₹4,142 vs DN150 ₹4,816 (same type/MOC/PN)')
  assert.ok(w.get('b')?.[0].includes('DN50'))
  assert.equal(w.has('c'), false)
  assert.ok(w.get('a')?.includes(COST_WARNING.NEGATIVE_VA))
  assert.ok(w.get('b')?.includes(COST_WARNING.NEGATIVE_VA))
})

test('actuator item with contract 3x its cost is flagged', () => {
  const w = evaluateCostWarnings([mk('x', 'DN80', 1700, { operationType: 'ACT+GB', contractReviewRate: '70,700' })])
  assert.match(w.get('x')![0], /cost ₹1,700 vs contract ₹70,700/)
})

test('ascending costs are not flagged', () => {
  const w = evaluateCostWarnings([mk('a', '50', 1000), mk('b', '100', 2000), mk('c', '200', 4000)])
  assert.equal(w.size, 0)
})
