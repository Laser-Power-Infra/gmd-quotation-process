import test from 'node:test'
import assert from 'node:assert/strict'
import { pendingValveCost, twoToOneUpdate } from '../lib/actuatorCost.js'
import { actuatorOp, bareValveOf, deriveMapKey, hasActuatorLink, isActuated, isActuatorCandidate, latestOffer, planActuator, SPECIAL_OEM, withoutProductCost } from '../lib/actuatorCost.js'
import { handPicks, selectActuator, type Master } from '../lib/actuatorSelect.js'
import { evaluateCostWarnings, COST_WARNING } from '../lib/costSanity.js'
import { FREE, MASTER } from './actuatorFixture.js'

test('MAP KEY from item type, size and PN; ACTUATOR lines read the valve type from the details', () => {
  assert.equal(deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16' }), 'BFV|500|PN16')
  assert.equal(deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: 'DN 700', pnRating: 'PN16' }), 'BFV|700|PN16')
  assert.equal(deriveMapKey({ itemType: 'SLUICE VALVE-RESILIENT-RISING', size: '700', pnRating: 'PN-10' }), 'SLUICE-RS|700|PN10')
  assert.equal(deriveMapKey({ itemType: 'SLUICE VALVE-METAL-NON-RISING', size: '700', pnRating: 'PN-10' }), 'SLUICE|700|PN10')
  assert.equal(deriveMapKey({ itemType: 'KNIFE GATE VALVE', size: '150', pnRating: 'PN-10' }), 'KGV|150|PN10')
  assert.equal(deriveMapKey({ itemType: 'ACTUATOR', itemName: 'Electric actuator for BFV', size: '1900', pnRating: 'PN-16' }), 'BFV|1900|PN16')
  assert.equal(deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-10/16' }), 'BFV|500|PN16') // dual rating: the higher one sizes the actuator
  assert.equal(deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN 1.6' }), null) // not a "/" list
  assert.equal(deriveMapKey({ itemType: 'CHECK VALVE', size: '500', pnRating: 'PN-16' }), null)
  assert.equal(deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: null, pnRating: 'PN-16' }), null)
})

test('op type only decides whether the item is actuated', () => {
  for (const o of ['ACT+GB', 'ACT', 'electric']) assert.deepEqual(actuatorOp(o), { act: true })
  assert.deepEqual(actuatorOp('STANDARD'), { act: false })
  assert.equal(isActuatorCandidate({ itemType: 'ACTUATOR', operationType: 'STANDARD' }), true)
  assert.equal(isActuatorCandidate({ itemType: 'BUTTERFLY VALVE', operationType: 'STANDARD' }), false)
})

test('latest offer wins; an undated offer never beats a dated one', () => {
  const d = (s: string) => new Date(s)
  assert.equal(latestOffer(d('2026-10-01'), d('2026-11-01')), true)
  assert.equal(latestOffer(d('2026-11-01'), d('2026-10-01')), false)
  assert.equal(latestOffer(null, d('2026-10-01')), true)
  assert.equal(latestOffer(d('2026-10-01'), null), false)
})

test('a pending actuator item raises the cost warning', () => {
  const w = evaluateCostWarnings([{ id: 'x', enquiryId: 'e', actuatorBreakdown: { pending: ['actuator price (A)'] } }])
  assert.deepEqual(w.get('x'), [COST_WARNING.ACTUATOR_PENDING])
})

type It = { itemType: string; size: string; pnRating: string; operationType: string; itemName?: string; productCost: number | null; bareValveCost: number | null; lastTotal: number | null; actuatorMake?: string | null; actCode?: string | null; gbCode?: string | null; actuatorBreakdown?: unknown }
// Mirrors applyActuatorToItem: hand codes, the pick (qty 2, no RM rates), the plan.
function plan(it: It, patch = {}, master: Master = MASTER) {
  const hand = handPicks(it, patch, master)
  const pick = selectActuator({ mapKey: deriveMapKey(it), actuatorItem: it.itemType === 'ACTUATOR', qty: 2, text: it.itemName ?? '', ...hand }, master, FREE, new Map())
  return { ...planActuator(it, pick, hand), selection: pick.selection }
}
const P500 = 56500 + 17625 + 6000 + 3000 // AUMA SA 12 (cheaper than K150) + stock VWESGA-80 + adaptor F25 + assembly DN500

test('a BFV always gets its Viral worm gearbox, whatever the Op Type says (ACT or ACT+GB)', () => {
  const it: It = { itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', operationType: 'ACT', productCost: 100, bareValveCost: null, lastTotal: null }
  const act = plan(it)
  assert.equal(act.selection.gb!.model, 'VWESGA-80')
  assert.equal(act.cost.total, 100 + P500)
  assert.equal(plan({ ...it, operationType: 'ACT+GB' }).cost.total, 100 + P500)
})

test('ACTUATOR item with a non-ACT Op Type: no valve; actuator + gearbox + adaptor + assembly as on a valve line', () => {
  const it: It = { itemType: 'ACTUATOR', itemName: 'Actuator for BFV', size: '700', pnRating: 'PN-16', operationType: 'STANDARD', productCost: 999, bareValveCost: null, lastTotal: null }
  const p = plan(it) // 14,287 Nm: the BFV rule gives VWESGA-150 whatever the Op Type
  assert.equal(p.cost.total, 56500 + 32000 + 6000 + 5000) // SA 12 + VWESGA-150 + adaptor F25 + assembly DN700
  assert.equal(plan({ ...it, operationType: 'ACT+GB' }).cost.total, 56500 + 32000 + 6000 + 5000)
})

test('Update BOM Costs on a pending actuated item: the refilled valve cost never becomes the total', () => {
  // recalculateItem hands every non-actuator productCost write to this plan as the valve cost; the SA 50 price is blank.
  const refilled: It = { itemType: 'SLUICE VALVE-METAL-RISING', size: '700', pnRating: 'PN-10', operationType: 'ACT', itemName: 'with AUMA actuator', productCost: 100000, bareValveCost: null, lastTotal: null }
  const blank: Master = { ...MASTER, actuators: MASTER.actuators.map((a) => (a.actCode === 'ACT-AU-SA50' || a.actCode === 'ACT-AU-SA60' || a.actCode === 'ACT-AU-SA100' ? { ...a, price: null } : a)) }
  const pending = plan(refilled, {}, blank)
  assert.equal(pending.cost.total, null)
  assert.equal(pending.bare, 100000) // kept for when the price arrives
  // price arrives in the sheet, next run: productCost was blanked, bare comes from the stored value
  const priced: Master = { ...MASTER, actuators: MASTER.actuators.map((a) => (a.actCode === 'ACT-AU-SA50' ? { ...a, price: 90000 } : a)) }
  const total = 100000 + 90000 + 16500 + 6000 + 5000 // SA 50 + SGB-2000 + adaptor F25 + assembly DN700
  assert.equal(plan({ ...refilled, productCost: null, bareValveCost: 100000 }, {}, priced).cost.total, total)
  // a re-run on the priced item does not count the total as the valve cost
  assert.equal(plan({ ...refilled, productCost: total, bareValveCost: 100000, lastTotal: total }, {}, priced).cost.total, total)
})

test('productCost + other fields on an actuated item: the other fields are kept for the normal path', () => {
  assert.deepEqual(withoutProductCost({ productCost: 100, quotedRate: 250 }), { quotedRate: 250 })
  assert.deepEqual(withoutProductCost({ productCost: 100, extension: '1m', bypass: null, quantity: 2, vaPercent: 30 }), { extension: '1m', bypass: null, quantity: 2, vaPercent: 30 })
  assert.equal(withoutProductCost({ productCost: 100 }), null)
  assert.equal(withoutProductCost({ productCost: 100, quotedRate: undefined }), null)
})

// ---- final-review fixes: link test, re-pricing on spec change --------------------------------------------------
// Mirrors syncActuatorOnChange + applyActuatorToItem: what ends up stored.
function run(it: It, before: It): It {
  if (!isActuatorCandidate(it)) {
    if (!hasActuatorLink(it)) return it
    return { ...it, productCost: bareValveOf(it), bareValveCost: null, lastTotal: null, actCode: null, gbCode: null, actuatorBreakdown: null }
  }
  const linked = hasActuatorLink(it)
  if (!linked && isActuatorCandidate(before)) return it // legacy row: untouched
  const p = plan(it, linked && deriveMapKey(before) !== deriveMapKey(it) ? { actCode: null, gbCode: null } : {})
  return { ...it, actuatorMake: p.make, actCode: p.actCode, gbCode: p.gbCode, bareValveCost: p.bare, lastTotal: p.cost.total, productCost: p.cost.total, actuatorBreakdown: { ...p.cost, selection: p.selection } }
}
const MAN: It = { itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', operationType: 'MANUAL', productCost: 100, bareValveCost: null, lastTotal: null, actCode: null, gbCode: null, actuatorBreakdown: null }

test('only a linked ACT item counts as actuated; a legacy ACT row is not', () => {
  assert.equal(isActuated({ operationType: 'ACT', itemType: 'BUTTERFLY VALVE' }), false)
  assert.equal(isActuated({ operationType: 'ACT', itemType: 'BUTTERFLY VALVE', actuatorBreakdown: { pending: [SPECIAL_OEM] } }), true) // Special marker is a link
  assert.equal(isActuated({ operationType: 'ACT+GB', itemType: 'BUTTERFLY VALVE', actCode: 'ACT-AU-SA14.2' }), true)
  assert.equal(isActuated({ operationType: 'MANUAL', itemType: 'BUTTERFLY VALVE', actCode: 'X' }), false)
})

test('legacy ACT row with no link keeps its cost on refill; a linked pending row stays blank', () => {
  const legacy = { ...MAN, operationType: 'ACT', productCost: 777 }
  assert.equal(isActuated(legacy), false) // recalculateItem does not reroute: the refilled cost stays as written
  assert.deepEqual(twoToOneUpdate(legacy, 50), { cost: 50 })
  assert.equal(run(legacy, legacy).productCost, 777) // a spec/dialog edit does not link or blank it either
  const pending = run({ ...MAN, operationType: 'ACT', size: '2500' }, MAN) // no MAPPING row for DN2500
  assert.equal(pending.productCost, null)
  assert.equal(isActuated(pending), true)
  const refilled = run({ ...pending, productCost: 100 }, pending) // BOM fill writes the valve cost
  assert.equal(refilled.productCost, null) // still blank while a price is pending
  assert.equal(refilled.bareValveCost, 100)
})

test('manual -> ACT+GB: valve cost kept as bare, parts added once', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  assert.equal(act.productCost, 100 + P500)
  assert.equal(act.bareValveCost, 100)
  assert.deepEqual([act.actuatorMake, act.actCode, act.gbCode], ['AUMA', 'ACT-AU-SA12', 'GB-VI-VWESGA80'])
})

test('ACT -> manual restores the bare valve cost and clears the breakdown', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const back = run({ ...act, operationType: 'MANUAL' }, act)
  assert.equal(back.productCost, 100)
  assert.deepEqual([back.actCode, back.gbCode, back.bareValveCost, back.actuatorBreakdown], [null, null, null, null])
  assert.equal(isActuated(back), false)
})

test('DN change re-picks from the new MAP KEY (a hand code is dropped) and re-prices; same MAP KEY keeps a hand code', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const hand = { ...act, actCode: 'RCB040006' } // typed in the Actuator dialog
  const moved = run({ ...hand, size: '700' }, hand)
  assert.deepEqual([moved.actCode, moved.gbCode], ['ACT-AU-SA12', 'GB-VI-VWESGA150'])
  assert.equal(moved.productCost, 100 + 56500 + 32000 + 6000 + 5000) // built from bareValveCost, not the old total
  const kept = run({ ...hand, operationType: 'ACT' }, hand)
  assert.equal(kept.actCode, 'RCB040006')
  assert.equal(kept.productCost, 100 + 53664 + 45000 + 6000 + 3000) // K30 stock line at its sheet price + the worm box that gives it <= 34 Nm in (VWESGA-250)
})

test('ACT -> manual -> ACT never double counts', () => {
  const a1 = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const m = run({ ...a1, operationType: 'MANUAL' }, a1)
  const a2 = run({ ...m, operationType: 'ACT+GB' }, m)
  assert.equal(a1.productCost, 100 + P500)
  assert.equal(a2.productCost, 100 + P500)
  assert.equal(a2.bareValveCost, 100)
})

test('pendingValveCost: the saved valve cost shows only while the actuator price is pending', () => {
  // Docket GMD/2026-27/340, 250 sluice ACT+GB: no MAPPING row, so productCost stays blank.
  const pending = { productCost: null, bareValveCost: 123123, actuatorBreakdown: { pending: ['actuator code'], total: null } }
  assert.equal(pendingValveCost(pending), 123123)
  assert.equal(pendingValveCost({ ...pending, bareValveCost: '96730' }), 96730)
  assert.equal(pendingValveCost({ ...pending, productCost: 200000 }), null)
  assert.equal(pendingValveCost({ ...pending, bareValveCost: null }), null)
  assert.equal(pendingValveCost({ ...pending, actuatorBreakdown: { pending: [], total: 1 } }), null)
  assert.equal(pendingValveCost({ ...pending, actuatorBreakdown: null }), null)
})
