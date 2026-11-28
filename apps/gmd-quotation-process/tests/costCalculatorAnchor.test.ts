import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCostChangeAnchor, isOfferRevision } from '../lib/rateAnchor.js'

test('default row: VA% is held, Quoted Rate is derived', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 9999, vaPercent: 20, validation: null })
  assert.equal(out.quotedRate, 1200)
  assert.equal(out.vaPercent, 20)
})

test('default row: Quoted Rate is rounded up to the nearest 10', () => {
  const out = resolveCostChangeAnchor({ cost: 1234, quotedRate: null, vaPercent: 15, validation: null })
  assert.equal(out.quotedRate, 1420) // 1419.1 -> 1420
})

test('default row with blank VA%: falls back to deriving VA% from the rate', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 1200, vaPercent: null, validation: null })
  assert.equal(out.quotedRate, 1200)
  assert.equal(out.vaPercent, 20)
})

test('validation Yes: Quoted Rate frozen, VA% absorbs the change', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 1500, vaPercent: 99, validation: 'Yes' })
  assert.equal(out.quotedRate, 1500)
  assert.equal(out.vaPercent, 50)
})

test('validation Yes with no rate: nothing is derived', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: null, vaPercent: 20, validation: 'Yes' })
  assert.equal(out.quotedRate, null)
  assert.equal(out.vaPercent, 20)
})

test('offer revision: only a sent docket whose rate actually moved', () => {
  assert.equal(isOfferRevision('u1', 1200, 1250), true)
  assert.equal(isOfferRevision('u1', 1200, null), true)
  assert.equal(isOfferRevision('u1', 1200, 1200.001), false) // same at stored precision
  assert.equal(isOfferRevision(null, 1200, 1250), false) // not sent yet
})

test('actuated item: VA% held on the valve portion, a flat 5% on the actuator portion', () => {
  const split = { valveCost: 100000, actCost: 50000, actVa: 5 }
  assert.deepEqual(resolveCostChangeAnchor({ cost: 150000, quotedRate: null, vaPercent: 35, validation: null, split }), { quotedRate: 187500, vaPercent: 35 })
  // Validated: the rate stays frozen, VA% is the valve VA% behind it.
  assert.deepEqual(resolveCostChangeAnchor({ cost: 150000, quotedRate: 200000, vaPercent: 20, validation: 'Yes', split }), { quotedRate: 200000, vaPercent: 47.5 })
})

test('item type ACTUATOR: whole-cost VA%; the 5% default gives cost x 1.05', () => {
  const split = { valveCost: 40000, actCost: 0, actVa: 5 } // splitLoadedCost for an ACTUATOR line
  assert.deepEqual(resolveCostChangeAnchor({ cost: 40000, quotedRate: null, vaPercent: 5, validation: null, split }), { quotedRate: 42000, vaPercent: 5 })
  // Validated 36,000 on a 40,000 cost: the real VA% (-10), so the row stays red.
  assert.deepEqual(resolveCostChangeAnchor({ cost: 40000, quotedRate: 36000, vaPercent: null, validation: 'Yes', split }), { quotedRate: 36000, vaPercent: -10 })
})

test('zero or negative cost is a no-op', () => {
  const out = resolveCostChangeAnchor({ cost: 0, quotedRate: 1500, vaPercent: 20, validation: null })
  assert.equal(out.quotedRate, 1500)
  assert.equal(out.vaPercent, 20)
})
