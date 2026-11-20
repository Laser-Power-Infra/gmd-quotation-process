import test from 'node:test'
import assert from 'node:assert/strict'
import { minVaPercent, vaRuleRate, isVaRuleViolation, splitLoadedCost, rateFor, vaFrom, loadedActCost, isActuatorOnly, costSplitText } from '../lib/vaRules.js'
import { getDefaultVaPercent } from '../lib/vaValidation.js'
import { roundUp } from '../lib/rounding.js'

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

test('sluice and check valve minimum follows the seat type: BOQ text, then item type, then docket spec', () => {
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemName: 'MS check valve' })), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemName: 'Check valve with bronze seat' })), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { seatSpec: 'metal seated' })), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemName: 'Resilient check valve', seatSpec: 'MS' })), 0)
  assert.equal(minVaPercent(it('SLUICE VALVE-RESILIENT-NON-RISING', '100', { itemName: 'Metal seated sluice valve' })), 30)
  assert.equal(minVaPercent(it('SLUICE VALVE-METAL-NON-RISING', '100', { itemName: 'Sluice valve 100 mm' })), 30)
  assert.equal(minVaPercent(it('SLUICE VALVE-RESILIENT-RISING', '100', { itemName: 'Sluice valve 100 mm' })), 15)
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

// Actuated items (Puja, 18 Nov 2026): VA% on the bare valve only, a flat 5% on the actuator portion.
// Linked DN500 BFV: cost 1,50,000 = valve 1,00,000 + actuator portion 50,000 (loaded, stored as actuatorBreakdown.actCost).
const BFV = { itemType: 'BUTTERFLY VALVE', size: 'DN500', itemName: 'BFV DN500', operationType: 'ACT+GB', actCode: 'ACT-AU-SA14.2' }
const act = (extra = {}) => ({ ...BFV, cost: 150000, actuatorBreakdown: { total: 1, actCost: 50000 }, ...extra })
const ACTUATOR = { itemType: 'ACTUATOR', size: '500', itemName: 'Electric actuator', actCode: 'ACT-AU-SA14.2', actuatorBreakdown: { total: 1 }, cost: 40000 }

test('actuated item: rate = valve x (1 + VA%) + actuator portion x 1.05', () => {
  const s = splitLoadedCost(act(), 150000)
  assert.deepEqual(s, { valveCost: 100000, actCost: 50000 })
  assert.equal(rateFor(s, 35), 135000 + 52500)
  assert.equal(vaFrom(187500, s), 35)
})

test('the actuator portion carries the same loadings; never negative', () => {
  assert.equal(loadedActCost(150000, 100000, 0.05), 56700) // 50,000 x 1.08 x 1.05
  assert.equal(loadedActCost(100000, 120000, 0.05), 0)
})

test('red row looks at the valve VA% only', () => {
  assert.equal(isVaRuleViolation(act({ vaPercent: 20, quotedRate: '172500' })), true) // below the DN500 BFV minimum of 35
  assert.equal(isVaRuleViolation(act({ vaPercent: 35, quotedRate: '187500' })), false) // VA% on the whole cost would be 25
  assert.equal(isVaRuleViolation(act({ vaPercent: 35, quotedRate: '187500', contractReviewRate: '180000' })), false)
  // Above CR and above the valve floor (1,87,500): red. The old whole-cost floor (2,02,500) hid this.
  assert.equal(isVaRuleViolation(act({ vaPercent: 42.5, quotedRate: '195000', contractReviewRate: '180000' })), true)
})

test('CR rate minus the actuator portion x 1.05 is the valve CR rate', () => {
  assert.equal(vaFrom(200000, splitLoadedCost(act(), 150000)), 47.5) // valve CR 1,47,500 on a 1,00,000 valve
  assert.equal(vaRuleRate(act({ contractReviewRate: '2,00,000' })), 200000)
  assert.equal(vaRuleRate(act({ contractReviewRate: '1,80,000' })), 187500) // valve CR 1,27,500 is below 35%: lifted
})

test('item type ACTUATOR: real VA% on the whole cost, minimum 5, no CR matching', () => {
  const s = splitLoadedCost(ACTUATOR, 40000)
  assert.deepEqual(s, { valveCost: 40000, actCost: 0 })
  assert.equal(isActuatorOnly(ACTUATOR), true)
  assert.equal(minVaPercent(ACTUATOR), 5)
  // Typed rate 36,000 on cost 40,000: VA% -10, red (so Validation = Yes is blocked too).
  assert.equal(vaFrom(36000, s), -10)
  assert.equal(isVaRuleViolation({ ...ACTUATOR, vaPercent: -10, quotedRate: '36000' }), true)
  // Blank rate: cost x 1.05, from the VA% 5 default and from Apply VA% rules.
  assert.equal(rateFor(s, 5), 42000)
  assert.equal(vaRuleRate(ACTUATOR), 42000)
  // No CR matching: a CR rate neither sets the rate nor turns the row red.
  assert.equal(vaRuleRate({ ...ACTUATOR, quotedRate: '36000', contractReviewRate: '50000' }), 42000)
  assert.equal(vaRuleRate({ ...ACTUATOR, quotedRate: '45000', contractReviewRate: '42000' }), 45000)
  assert.equal(isVaRuleViolation({ ...ACTUATOR, vaPercent: 12.5, quotedRate: '45000', contractReviewRate: '42000' }), false)
})

test('a valve whose valve portion is 0 is not an ACTUATOR line: valve minimum on the whole cost', () => {
  const zero = act({ cost: 50000 }) // actuator portion 50,000 = the whole cost
  assert.equal(isActuatorOnly(zero), false)
  assert.deepEqual(splitLoadedCost(zero, 50000), { valveCost: 50000, actCost: 0 })
  assert.equal(isVaRuleViolation({ ...zero, vaPercent: 20, quotedRate: '60000' }), true) // below the DN500 BFV minimum of 35
  assert.equal(vaRuleRate(zero), 67500) // 50,000 x 1.35
  assert.equal(isVaRuleViolation(act({ cost: 50001, vaPercent: 20, quotedRate: '52510' })), true) // tiny valve portion: same minimum
})

test('valve cost 0: the paise left by rounding cost and actuator portion separately is not a valve portion', () => {
  // Actuator total 50,625, loadings 4.5%: cost 57,135.38 but actuator portion 57,135.37 (each rounded to 2 dp).
  const actCost = loadedActCost(50625, 0, 0.045)
  assert.equal(actCost, 57135.37)
  const it0 = act({ cost: 57135.38, actuatorBreakdown: { total: 50625, actCost } })
  const s = splitLoadedCost(it0, 57135.38)
  assert.deepEqual(s, { valveCost: 57135.38, actCost: 0 }) // valve Rs 0.01 < Rs 1: whole cost
  assert.equal(rateFor(s, 35), 77130) // not 59,990 (= cost x 1.05)
  assert.equal(vaFrom(59990, s), 5)
  assert.equal(isVaRuleViolation({ ...it0, vaPercent: 5, quotedRate: '59990' }), true) // red against the DN500 BFV minimum of 35
})

test('non-actuated, legacy unlinked and not-yet-split rows: whole cost, same numbers as before', () => {
  // Plain valve; unlinked ACT row; unlinked ACTUATOR row; linked but priced before the split (no actCost yet).
  for (const row of [{ itemType: 'BUTTERFLY VALVE', operationType: 'GB' }, { ...BFV, actCode: null }, { itemType: 'ACTUATOR' }, BFV]) {
    const s = splitLoadedCost(row, 1234.56)
    assert.deepEqual(s, { valveCost: 1234.56, actCost: 0 })
    for (const va of [0, 15, 35, 47.5]) assert.equal(rateFor(s, va), roundUp(1234.56 * (1 + va / 100)))
    for (const r of [1300, 1420, 2000]) assert.equal(vaFrom(r, s), parseFloat((((r / 1234.56) - 1) * 100).toFixed(2)))
  }
  assert.equal(isActuatorOnly({ itemType: 'ACTUATOR' }), false)
})

test('chip line under Cost shows both portions', () => {
  assert.equal(costSplitText(act({ vaPercent: 35 })), 'Valve 1,00,000 @ 35% + Actuator 50,000 @ 5%')
  assert.equal(costSplitText({ ...ACTUATOR, vaPercent: 5 }), null) // no split: its VA% column is the whole-cost VA%
  assert.equal(costSplitText({ itemType: 'BUTTERFLY VALVE', cost: 1000, vaPercent: 20 }), null)
})
