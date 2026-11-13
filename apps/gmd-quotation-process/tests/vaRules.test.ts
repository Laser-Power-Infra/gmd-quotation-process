import test from 'node:test'
import assert from 'node:assert/strict'
import { minVaPercent, vaRuleRate, isVaRuleViolation } from '../lib/vaRules.js'
import { getDefaultVaPercent } from '../lib/vaValidation.js'

const it = (itemType: string, size = '100', extra = {}) => ({ itemType, size, itemName: itemType, cost: 1000, ...extra })

test('minimum VA% per item type and size', () => {
  assert.equal(minVaPercent(it('SLUICE VALVE-RESILIENT-RISING')), 15)
  assert.equal(minVaPercent(it('SLUICE VALVE-METAL-NON-RISING')), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemName: 'Metal seated check valve' })), 30)
  assert.equal(minVaPercent(it('CHECK VALVE')), 0)
  assert.equal(minVaPercent(it('BUTTERFLY VALVE', '450')), 20)
  assert.equal(minVaPercent(it('BUTTERFLY VALVE', 'DN500')), 35)
  assert.equal(minVaPercent(it('TPAV')), 35)
  assert.equal(minVaPercent(it('EXPANSION BELOWS', '1000')), 0)
  assert.equal(minVaPercent(it('EXPANSION BELOWS', '1100')), 45)
  assert.equal(minVaPercent(it('DPCV', '600')), 20)
  assert.equal(minVaPercent(it('DPCV', '700')), 35)
  assert.equal(minVaPercent(it('PLUG VALVE')), 100)
})

test('a new item never starts red: default VA% is at least the minimum', () => {
  const types = ['SLUICE VALVE-RESILIENT-RISING', 'SLUICE VALVE-METAL-RISING', 'CHECK VALVE', 'BUTTERFLY VALVE', 'TPAV', 'TPV', 'EXPANSION BELOWS', 'DPCV', 'PLUG VALVE']
  for (const type of types)
    for (const size of ['', '80', '450', '500', '600', '700', '1000', '1100', '1400'])
      assert.ok(getDefaultVaPercent(type, size)! >= minVaPercent(it(type, size)), `${type} DN${size}`)
})

test('rate = CR rate, lifted to the minimum VA% when CR gives less', () => {
  assert.equal(vaRuleRate(it('TPAV', '80', { contractReviewRate: '1,500' })), 1500)
  assert.equal(vaRuleRate(it('TPAV', '80', { contractReviewRate: '1100' })), 1350)
})

test('VA% is never negative, even with no rule', () => {
  assert.equal(vaRuleRate(it('GATE VALVE', '80', { contractReviewRate: '800' })), 1000)
  assert.equal(isVaRuleViolation(it('GATE VALVE', '80', { quotedRate: '900', vaPercent: -10 })), true)
})

test('rate is capped at the previous party rate, but the minimum still wins', () => {
  assert.equal(vaRuleRate(it('SLUICE VALVE-RESILIENT-RISING', '80', { contractReviewRate: '1600' }), 1300), 1300)
  assert.equal(vaRuleRate(it('SLUICE VALVE-RESILIENT-RISING', '80', { contractReviewRate: '1600' }), 1100), 1150)
  assert.equal(vaRuleRate(it('SLUICE VALVE-RESILIENT-RISING', '80', { contractReviewRate: '1600' }), null), 1600)
})

test('red row: below minimum or above CR, not an upper VA% limit', () => {
  assert.equal(isVaRuleViolation(it('TPAV', '80', { quotedRate: '1200', vaPercent: 20 })), true)
  assert.equal(isVaRuleViolation(it('TPAV', '80', { quotedRate: '1900', vaPercent: 90, contractReviewRate: '1900' })), false)
  assert.equal(isVaRuleViolation(it('TPAV', '80', { quotedRate: '2000', vaPercent: 100, contractReviewRate: '1900' })), true)
})
