import test from 'node:test'
import assert from 'node:assert/strict'
import { fiscalMonths, lightOf, monthKey, readyValue, stageOf } from '../lib/executionPages.js'

const base = { orderQty: 10, prodOrdQty: 0, diQty: 0, billedQty: 0, productionOrderNumber: null, offerNumber: [], inspectionNumber: [], diDate: [] }

test('stageOf walks order -> done', () => {
  assert.equal(stageOf(base), 'Order')
  assert.equal(stageOf({ ...base, prodOrdQty: 10 }), 'Production')
  assert.equal(stageOf({ ...base, prodOrdQty: 10, offerNumber: ['O1'] }), 'Inspection')
  assert.equal(stageOf({ ...base, offerNumber: ['O1'], inspectionNumber: ['I1'] }), 'Dispatch')
  assert.equal(stageOf({ ...base, inspectionNumber: ['I1'], diQty: 10, billedQty: 4 }), 'Bill')
  assert.equal(stageOf({ ...base, diQty: 10, billedQty: 10 }), 'Done')
})

test('lightOf and readyValue', () => {
  assert.equal(lightOf('Bill', 30), 'green')
  assert.equal(lightOf('Bill', 90), 'amber')
  assert.equal(lightOf('Bill', 200), 'red')
  assert.equal(lightOf('Done', 200), 'green')
  assert.equal(readyValue({ balBillAgMc: 2, balBillAgMcVal: 0, rate: 50 }), 100)
  assert.equal(readyValue({ balBillAgMc: 2, balBillAgMcVal: 120, rate: 50 }), 120)
  assert.equal(readyValue({ balBillAgMc: 0, balBillAgMcVal: 120, rate: 50 }), 0)
})

test('monthKey and fiscalMonths', () => {
  assert.equal(monthKey('12-Apr-26'), '2026-04')
  assert.equal(monthKey(''), null)
  const m = fiscalMonths('2026-27')
  assert.equal(m[0], '2026-04')
  assert.equal(m[11], '2027-03')
})
