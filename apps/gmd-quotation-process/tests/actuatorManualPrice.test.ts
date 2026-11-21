import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActuatorCost, deriveMapKey, HAND_PRICE, planActuator, SPECIAL_OEM } from '../lib/actuatorCost.js'
import { handPicks, selectActuator } from '../lib/actuatorSelect.js'
import { FREE, MASTER } from './actuatorFixture.js'

// docket GMD/2026-27/580: ACTUATOR lines, ACT+GB. 500 PN16 prices to AUMA SA 12 + stock VWESGA-80 + adaptor + assembly = 74,125 (qty 2).
type It = { itemType: string; itemName?: string; size: string; pnRating: string; operationType: string; productCost: number | null; bareValveCost: number | null; actuatorBreakdown?: { total?: number | null; manualTotal?: number } | null }
const ACT: It = { itemType: 'ACTUATOR', itemName: 'Actuator for BFV', size: '500', pnRating: 'PN-16', operationType: 'ACT+GB', productCost: null, bareValveCost: null, actuatorBreakdown: null }
const OEM: It = { ...ACT, size: '1300' } // BFV|1300|PN16 qty 1 is "Special – refer OEM"

// Mirrors applyActuatorToItem: what it stores. manual: number sets, null clears, undefined keeps the breakdown's.
function apply(it: It, manual?: number | null, qty = 2) {
  const hand = handPicks(it, {}, MASTER)
  const pick = selectActuator({ mapKey: deriveMapKey(it), actuatorItem: it.itemType === 'ACTUATOR', qty, text: it.itemName ?? '', ...hand }, MASTER, FREE, new Map())
  const m = manual !== undefined ? manual : it.actuatorBreakdown?.manualTotal
  const p = planActuator({ itemType: it.itemType, productCost: it.productCost, bareValveCost: it.bareValveCost, lastTotal: it.actuatorBreakdown?.total ?? null }, pick, hand, m)
  return { ...it, productCost: p.cost.total, bareValveCost: p.bare, actuatorBreakdown: { ...p.cost, selection: pick.selection } as It['actuatorBreakdown'], plan: p, pick }
}

test('bug: 85,000 typed on a linked ACTUATOR line is the product cost, not the rebuilt 74,125', () => {
  assert.equal(apply(ACT).productCost, 74125)
  const typed = apply({ ...ACT, productCost: 85000 }, 85000)
  assert.equal(typed.productCost, 85000)
  assert.deepEqual(typed.plan.cost.pending, [])
  assert.equal(typed.actuatorBreakdown!.manualTotal, 85000)
  assert.match(typed.plan.cost.text, new RegExp(HAND_PRICE))
  assert.equal(typed.pick.selection.act!.model, 'SA 12') // the pick still shows
  assert.equal(typed.plan.actCode, 'ACT-AU-SA12')
})

test('refer-OEM line: a typed price is the product cost, not pending; without one it stays pending as before', () => {
  assert.equal(apply(OEM, undefined, 1).productCost, null)
  assert.deepEqual(apply(OEM, undefined, 1).plan.cost.pending, [SPECIAL_OEM])
  const typed = apply({ ...OEM, productCost: 150000 }, 150000, 1)
  assert.equal(typed.productCost, 150000)
  assert.deepEqual(typed.plan.cost.pending, [])
  assert.equal(typed.pick.selection.status, 'OEM RFQ') // still an OEM line: RFQ draft and offer text unchanged
  assert.deepEqual([typed.plan.actCode, typed.plan.gbCode], [null, null])
})

test('a re-price keeps the manual price; clearing returns to automatic / pending', () => {
  const typed = apply({ ...ACT, productCost: 85000 }, 85000)
  const again = apply(typed) // Fetch Actuator / re-price: breakdown.manualTotal wins, whatever a BOM fill wrote into productCost
  assert.equal(again.productCost, 85000)
  assert.equal(apply({ ...typed, productCost: 123 }).productCost, 85000)
  assert.equal(apply({ ...typed, productCost: null, bareValveCost: null }, null).productCost, 74125)
  const oem = apply({ ...OEM, productCost: 150000 }, 150000, 1)
  assert.equal(apply({ ...oem, productCost: null }, null, 1).productCost, null)
  assert.deepEqual(apply({ ...oem, productCost: null }, null, 1).plan.cost.pending, [SPECIAL_OEM])
})

test('a manual price is dropped once the line is no longer an ACTUATOR / refer-OEM case', () => {
// valve line, refer-OEM at DN1300 with a typed 150,000; then DN500 (priced automatically): the typed number is not the valve cost  const oem = apply({ ...OEM, itemType: 'BUTTERFLY VALVE', productCost: 150000 }, 150000, 1)  assert.equal(oem.productCost, 150000)  const moved = apply({ ...oem, size: '500' }, undefined, 1)  assert.equal(moved.actuatorBreakdown!.manualTotal, undefined)  assert.equal(moved.plan.cost.total, null) // pending: bare valve cost  // ACTUATOR line turned into a valve line: the whole-price number is dropped too  const gone = apply({ ...apply({ ...ACT, productCost: 85000 }, 85000), itemType: 'BUTTERFLY VALVE' })  assert.equal(gone.actuatorBreakdown!.manualTotal, undefined)
})

test('ordinary actuated valve line: a typed product cost is still the valve cost, parts added', () => {
  const v: It = { ...ACT, itemType: 'BUTTERFLY VALVE', productCost: 100 }
  assert.equal(apply(v, 100).productCost, 100 + 56500 + 17625 + 6000 + 3000)
  assert.equal(apply(v).bareValveCost, 100)
})

test('buildActuatorCost without a manual total is unchanged; a zero / blank manual total is ignored', () => {
  const pick = selectActuator({ mapKey: 'BFV|500|PN16', actuatorItem: true, qty: 2, text: '', make: null, actCode: null, gbCode: null }, MASTER, FREE, new Map())
  assert.equal(buildActuatorCost(pick, null, true).total, 74125)
  assert.equal(buildActuatorCost(pick, null, true, 0).total, 74125)
  assert.equal(buildActuatorCost(pick, null, true, null).total, 74125)
})
