import test from 'node:test'
import assert from 'node:assert/strict'
import { actVaPercent, actVaOfSize, minVaPercent, vaRuleRate, isVaRuleViolation, splitLoadedCost, rateFor, vaFrom, loadedActCost, isActuatorOnly, costSplitText, actuatorMarkupShort } from '../lib/vaRules.js'
import { getDefaultVaPercent } from '../lib/vaValidation.js'
import { roundUp } from '../lib/rounding.js'

const it = (itemType: string, size = '100', extra = {}) => ({ itemType, size, itemName: itemType, cost: 1000, ...extra })

test('minimum VA% per item type and size', () => {
  assert.equal(minVaPercent(it('SLUICE VALVE-RESILIENT-RISING')), 15)
  assert.equal(minVaPercent(it('SLUICE VALVE-METAL-NON-RISING')), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemNameMerge: 'Metal seated' })), 30)
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

test("sluice and check valve minimum follows the item's own category, never the BOQ text or docket spec", () => {
  assert.equal(minVaPercent(it('SLUICE VALVE-RESILIENT-NON-RISING', '100', { itemName: 'MS sluice valve' })), 15)
  assert.equal(minVaPercent(it('SLUICE VALVE-METAL-NON-RISING', '100', { itemName: 'Resilient sluice valve' })), 30)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemName: 'MS check valve', seatSpec: 'metal seated' })), 0)
  assert.equal(minVaPercent(it('CHECK VALVE', '100', { itemNameMerge: 'CHECK VALVE-DI-100-PN10-METAL SEATED' })), 30)
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
  assert.deepEqual(s, { valveCost: 100000, actCost: 50000, actVa: 5 })
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
  assert.deepEqual(s, { valveCost: 40000, actCost: 0, actVa: 5 })
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
  assert.deepEqual(splitLoadedCost(zero, 50000), { valveCost: 50000, actCost: 0, actVa: 5 })
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
  assert.deepEqual(s, { valveCost: 57135.38, actCost: 0, actVa: 5 }) // valve Rs 0.01 < Rs 1: whole cost
  assert.equal(rateFor(s, 35), 77130) // not 59,990 (= cost x 1.05)
  assert.equal(vaFrom(59990, s), 5)
  assert.equal(isVaRuleViolation({ ...it0, vaPercent: 5, quotedRate: '59990' }), true) // red against the DN500 BFV minimum of 35
})

test('non-actuated, legacy unlinked and not-yet-split rows: whole cost, same numbers as before', () => {
  // Plain valve; unlinked ACT row; unlinked ACTUATOR row; linked but priced before the split (no actCost yet).
  for (const row of [{ itemType: 'BUTTERFLY VALVE', operationType: 'GB' }, { ...BFV, actCode: null }, { itemType: 'ACTUATOR' }, BFV]) {
    const s = splitLoadedCost(row, 1234.56)
    assert.deepEqual(s, { valveCost: 1234.56, actCost: 0, actVa: 5 })
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

// Actuator mark-up by valve size (Puja, 23 Nov 2026): 5% up to DN750, 10% from DN800.
const big = (size: string | null, extra = {}) => ({ ...BFV, size, cost: 300000, actuatorBreakdown: { total: 1, actCost: 200000 }, ...extra })

test('actuator mark-up: 5% up to DN750, 10% above; blank size is 5%', () => {
  assert.equal(actVaPercent(750), 5)
  assert.equal(actVaPercent(751), 10)
  assert.equal(actVaPercent(800), 10)
  assert.equal(actVaPercent(null), 5)
})

test('valve line: actuator portion x 1.10 at DN800, x 1.05 at DN750', () => {
  const s800 = splitLoadedCost(big('DN 800'), 300000)
  assert.deepEqual(s800, { valveCost: 100000, actCost: 200000, actVa: 10 })
  assert.equal(rateFor(s800, 35), 355000) // 1,00,000 x 1.35 + 2,00,000 x 1.10
  assert.equal(vaFrom(355000, s800), 35)
  assert.equal(rateFor(splitLoadedCost(big('DN 750'), 300000), 35), 345000)
  // Blank or unreadable size: 5%, never 10% by accident, never a crash.
  for (const size of ['', null, 'TBA']) assert.equal(rateFor(splitLoadedCost(big(size), 300000), 35), 345000)
  assert.equal(vaRuleRate(big('DN 800')), 355000) // Apply VA% rules: DN800 BFV minimum 35 + actuator x 1.10
  assert.equal(isVaRuleViolation(big('DN 800', { vaPercent: 35, quotedRate: '355000' })), false)
  assert.ok(costSplitText(big('DN 800', { vaPercent: 35 }))!.endsWith('@ 10%'))
  assert.ok(costSplitText(big('DN 750', { vaPercent: 35 }))!.endsWith('@ 5%'))
})

test('item type ACTUATOR: minimum 10 from DN800, 5 below or with a blank size', () => {
  assert.equal(minVaPercent({ ...ACTUATOR, size: '800' }), 10)
  assert.equal(minVaPercent({ ...ACTUATOR, size: '500' }), 5)
  assert.equal(minVaPercent({ ...ACTUATOR, size: '' }), 5)
  // A DN800 line saved at the old 5% shows red until Fetch Actuator is pressed; it is not re-priced silently.
  assert.equal(isVaRuleViolation({ ...ACTUATOR, size: '800', vaPercent: 5, quotedRate: '42000' }), true)
  assert.equal(isVaRuleViolation({ ...ACTUATOR, size: '800', vaPercent: 10, quotedRate: '44000' }), false)
  assert.equal(vaRuleRate({ ...ACTUATOR, size: '800' }), 44000) // blank rate: cost x 1.10
})

// Review fixes (23 Nov 2026).
test('actuator mark-up reads the first number of the size text, like the actuator pick (deriveMapKey)', () => {
  for (const size of ['DN500 PN16', '500 (20")', '750.0', '100x80', '700/750', '', null, 'TBA']) {
    assert.equal(actVaOfSize(size), 5, String(size))
    assert.equal(splitLoadedCost(big(size), 300000).actVa, 5, String(size))
    assert.equal(minVaPercent({ ...ACTUATOR, size }), 5, String(size))
  }
  for (const size of ['800', 'DN 800', '800 MM', '800x600']) {
    assert.equal(actVaOfSize(size), 10, size)
    assert.equal(splitLoadedCost(big(size), 300000).actVa, 10, size)
    assert.equal(minVaPercent({ ...ACTUATOR, size }), 10, size)
  }
  // valve 1,00,000 at 35% + actuator 2,00,000: 3,45,000, not 3,55,000
  assert.equal(rateFor(splitLoadedCost(big('DN500 PN16'), 300000), 35), 345000)
})

test('up to DN750 the minimum rate is actuator x 1.05 exactly as before: not a paisa moves', () => {
  // Written by Apply VA% rules before 23 Nov: 5,38,928.32. (x 105 / 100 gives 5,38,928.31 and turned this row red.)
  const line = { ...BFV, cost: 449219.22, actuatorBreakdown: { total: 1, actCost: 225058.79 }, contractReviewRate: '500000', quotedRate: '538928.32', vaPercent: 35 }
  assert.equal(vaRuleRate(line), 538928.32)
  assert.equal(isVaRuleViolation(line), false)
  assert.equal(vaRuleRate(big('DN 800')), 355000) // the 10% case keeps clear of 3,55,000.01
})

test('valve line of DN800+ saved at the old 5%: red, not re-priced; a rate that covers the new minimum is not red', () => {
  const old = big('DN 800', { vaPercent: 35, quotedRate: '345000' }) // 1,00,000 x 1.35 + 2,00,000 x 1.05
  assert.equal(isVaRuleViolation(old), true)
  assert.equal(isVaRuleViolation(big('DN 800', { vaPercent: 35, quotedRate: '355000' })), false)
  assert.equal(isVaRuleViolation(big('DN 800', { vaPercent: 45, quotedRate: '365000' })), false)
  assert.equal(isVaRuleViolation(big('DN 800', { vaPercent: 35, quotedRate: '' })), false) // no rate yet
  // Up to DN750 nothing changes colour: the same stored line, and even a rate under the minimum, stay as before.
  for (const size of ['DN 750', '750.0', 'DN500 PN16', '700/750', '']) {
    assert.equal(isVaRuleViolation(big(size, { vaPercent: 35, quotedRate: '345000' })), false, size)
    assert.equal(isVaRuleViolation(big(size, { vaPercent: 35, quotedRate: '300000' })), false, size)
  }
})

// Final review I1 (23 Nov 2026): the stored rate is compared with the rate its own VA% gives, not only the minimum rate.
test('valve line of DN800+ above its minimum VA% whose rate still holds the old 5%: red', () => {
  const line = (extra = {}) => ({ ...BFV, size: 'DN800', cost: 554580, actuatorBreakdown: { total: 1, actCost: 122580 }, ...extra })
  assert.equal(rateFor(splitLoadedCost(line(), 554580), 40), 739640) // 4,32,000 x 1.40 + 1,22,580 x 1.10
  assert.equal(isVaRuleViolation(line({ vaPercent: 40, quotedRate: '733510' })), true) // built with x 1.05
  assert.equal(isVaRuleViolation(line({ vaPercent: 50, quotedRate: '776710' })), true)
  assert.equal(isVaRuleViolation(line({ vaPercent: 40, quotedRate: '739640' })), false) // the new rate
  assert.equal(isVaRuleViolation(line({ vaPercent: 50, quotedRate: '782840' })), false)
  // Up to DN750 no line changes colour, whatever its rate.
  for (const size of ['DN 750', '750.0', 'DN500 PN16', '700/750', ''])
    for (const quotedRate of ['733510', '739640', '700000'])
      assert.equal(isVaRuleViolation(line({ size, vaPercent: 40, quotedRate })), false, `${size} ${quotedRate}`)
  // Item type ACTUATOR of DN800: no actuator portion in the split, so only its minimum VA% of 10 counts, as before.
  assert.equal(isVaRuleViolation({ ...ACTUATOR, size: '800', vaPercent: 20, quotedRate: '44000' }), false)
  assert.equal(isVaRuleViolation({ ...ACTUATOR, size: '800', vaPercent: 5, quotedRate: '42000' }), true)
})

test('DN800+ rate set by an existing rule (CR match, previous-rate cap, typed rate) is not red: its VA% is the rate\'s own, to 2 dp', () => {
  const line = (extra = {}) => ({ ...BFV, size: 'DN800', cost: 554580, actuatorBreakdown: { total: 1, actCost: 122580 }, ...extra })
  const s = splitLoadedCost(line(), 554580)
  // Every rate from the minimum up, in odd steps so the stored VA% rounds both ways (0.005% of the valve is Rs 21.60).
  for (let rate = 718040; rate < 800000; rate += 137.37) {
    const r = parseFloat(rate.toFixed(2))
    assert.equal(isVaRuleViolation(line({ vaPercent: vaFrom(r, s), quotedRate: String(r) })), false, String(r))
  }
  // CR match and previous-rate cap as "Apply VA% rules" writes them.
  const cr = vaRuleRate(line({ contractReviewRate: '739620.72' }))!
  assert.equal(cr, 739620.72)
  assert.equal(isVaRuleViolation(line({ contractReviewRate: '739620.72', quotedRate: String(cr), vaPercent: vaFrom(cr, s) })), false)
  const capped = vaRuleRate(line({ contractReviewRate: '760000' }), 745123.4)!
  assert.equal(capped, 745123.4)
  assert.equal(isVaRuleViolation(line({ contractReviewRate: '760000', quotedRate: String(capped), vaPercent: vaFrom(capped, s) })), false)
})

test('validation refusal: the actuator mark-up reason is told apart from the other red reasons', () => {
  const line = (extra = {}) => ({ ...BFV, size: 'DN800', cost: 554580, actuatorBreakdown: { total: 1, actCost: 122580 }, ...extra })
  assert.equal(actuatorMarkupShort(line({ vaPercent: 40, quotedRate: '733510' })), true)
  assert.equal(actuatorMarkupShort(line({ vaPercent: 35, quotedRate: '711910' })), true) // at its minimum, old 5% rate
  assert.equal(actuatorMarkupShort({ ...ACTUATOR, size: '800', vaPercent: 5, quotedRate: '42000' }), true)
  assert.equal(actuatorMarkupShort(line({ vaPercent: 40, quotedRate: '739640' })), false)
  // Red for another reason: VA% under the valve minimum, rate above the CR rate, any line up to DN750.
  assert.equal(actuatorMarkupShort(line({ vaPercent: 20, quotedRate: '653240' })), false)
  assert.equal(isVaRuleViolation(line({ vaPercent: 20, quotedRate: '653240' })), true)
  assert.equal(actuatorMarkupShort(line({ vaPercent: 45, quotedRate: '761240', contractReviewRate: '740000' })), false)
  assert.equal(isVaRuleViolation(line({ vaPercent: 45, quotedRate: '761240', contractReviewRate: '740000' })), true)
  assert.equal(actuatorMarkupShort(act({ vaPercent: 20, quotedRate: '172500' })), false)
  assert.equal(actuatorMarkupShort({ ...ACTUATOR, vaPercent: -10, quotedRate: '36000' }), false)
})
