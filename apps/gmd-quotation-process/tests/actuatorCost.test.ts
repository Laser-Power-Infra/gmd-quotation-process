import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { readActuatorWorkbook } from '../lib/actuatorMaster.js'
import { twoToOneUpdate } from '../lib/actuatorCost.js'
import { actuatorOp, bareValveOf, buildActuatorCost, deriveMapKey, hasActuatorLink, isActuated, isActuatorCandidate, latestOffer, pickCodes, planActuator, SPECIAL_OEM, withoutProductCost } from '../lib/actuatorCost.js'
import { evaluateCostWarnings, COST_WARNING } from '../lib/costSanity.js'

const GBS = [
  { gbCode: 'GB-AU-125.3', model: 'GS 125.3 + VZ', dataStatus: 'Indicative' },
  { gbCode: 'GB-RT-IW', model: 'IW3 … IW13', dataStatus: 'Range only' },
]
const BFV500 = { gearbox: 'GS 125.3 + VZ', aumaActCode: 'ACT-AU-SA14.2', rotorkActCode: 'ACT-RT-IQ20' }
const SPECIAL = { gearbox: 'Special – refer OEM', aumaActCode: null, rotorkActCode: null }

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

test('pickCodes: AUMA by default, Rotork when the item has that make', () => {
  assert.deepEqual(pickCodes(BFV500, null, GBS), { special: false, make: 'AUMA', actCode: 'ACT-AU-SA14.2', gbCode: 'GB-AU-125.3', gbWanted: true, gbMissing: false })
  assert.equal(pickCodes(BFV500, 'Rotork', GBS).actCode, 'ACT-RT-IQ20')
})

test('Special - refer OEM: no code, no cost', () => {
  const p = pickCodes(SPECIAL, null, GBS)
  assert.deepEqual([p.special, p.actCode, p.gbCode], [true, null, null])
  const c = buildActuatorCost({ actuatorItem: true, special: true, bare: null, act: null, gb: null })
  assert.equal(c.total, null)
  assert.deepEqual(c.pending, [SPECIAL_OEM])
})

test('GB-RT-IW range placeholder is never picked', () => {
  const p = pickCodes({ gearbox: 'IW3 … IW13', aumaActCode: 'A', rotorkActCode: 'B' }, null, GBS)
  assert.equal(p.gbCode, null)
  assert.equal(p.gbMissing, true)
})

test('cost = valve + actuator + gearbox + adaptor + assembly, each part shown', () => {
  const c = buildActuatorCost({
    actuatorItem: false, bare: 100000,
    act: { code: 'ACT-AU-SA14.2', price: 50000 }, gb: { code: 'GB-AU-125.3', price: 30000 },
    adaptor: 2000, assembly: 3000,
  })
  assert.equal(c.total, 185000)
  assert.match(c.text, /Valve 1,00,000 \+ ACT ACT-AU-SA14\.2 50,000 \+ GB GB-AU-125\.3 30,000 \+ Adaptor\/coupling 2,000 \+ Assembly & testing 3,000 = 1,85,000/)
})

test('blank price = price pending, never a lower total (blank adaptor/assembly are 0)', () => {
  const noGb = buildActuatorCost({ actuatorItem: false, bare: 100000, act: { code: 'A', price: 50000 }, gb: { code: 'G', price: null } })
  assert.equal(noGb.total, null)
  assert.deepEqual(noGb.pending, ['gearbox price (G)'])
  assert.match(noGb.text, /^Price pending/)
  assert.equal(buildActuatorCost({ actuatorItem: false, bare: null, act: { code: 'A', price: 1 }, gb: null }).total, null)
  assert.equal(buildActuatorCost({ actuatorItem: false, bare: 10, act: { code: null, price: null }, gb: null }).total, null)
  assert.equal(buildActuatorCost({ actuatorItem: false, bare: 10, act: { code: 'A', price: 5 }, gb: null, adaptor: null, assembly: null }).total, 15)
  // a real 0 price is a price, not pending
  assert.equal(buildActuatorCost({ actuatorItem: false, bare: 10, act: { code: 'A', price: 0 }, gb: null }).total, 10)
})

test('ACTUATOR item = actuator + gearbox only (no bare valve)', () => {
  const c = buildActuatorCost({ actuatorItem: true, bare: 999999, act: { code: 'A', price: 50000 }, gb: { code: 'G', price: 30000 } })
  assert.equal(c.total, 80000)
  assert.ok(!c.parts.some((p) => p.label === 'Valve'))
})

test('expired offer is noted in the build-up; latest offer wins', () => {
  const c = buildActuatorCost({ actuatorItem: true, bare: null, act: { code: 'A', price: 1, validTill: new Date('2026-01-01') }, gb: null, now: new Date('2026-11-10') })
  assert.match(c.text, /expired/)
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

// The real workbook is not in git (tmp is ignored): runs only when present.
const REAL = path.join(__dirname, '..', '..', '..', 'tmp', 'GMD_Actuator_Master.xlsx')
test('docket 580 DN500 BFV PN16 ACT+GB fills act_code / gb_code from the real MAPPING row', { skip: !existsSync(REAL) }, () => {
  const p = readActuatorWorkbook(REAL)
  const key = deriveMapKey({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16' })!
  const m = p.mappings.find((r) => r.mapKey === key)!
  assert.equal(m.gearbox, 'GS 125.3 + VZ')
  assert.equal(m.aumaModel, 'SA 14.2')
  assert.equal(m.rotorkModel, 'IQ20')
  const gbs = p.gearboxes.map((g) => ({ gbCode: String(g.gbCode), model: g.model as string, dataStatus: g.dataStatus as string }))
  const auma = pickCodes(m as never, null, gbs)
  assert.deepEqual([auma.actCode, auma.gbCode], ['ACT-AU-SA14.2', 'GB-AU-125.3'])
  assert.equal(pickCodes(m as never, 'Rotork', gbs).actCode, 'ACT-RT-IQ20')
  // DN1300 / DN1900 are Special - refer OEM
  for (const k of ['BFV|1300|PN16', 'BFV|1900|PN16']) {
    const sp = pickCodes(p.mappings.find((r) => r.mapKey === k)! as never, null, gbs)
    assert.deepEqual([sp.special, sp.actCode, sp.gbCode], [true, null, null], k)
  }
})

const DIRECT = { gearbox: '— (direct)', aumaActCode: 'ACT-AU-SA14.6', rotorkActCode: 'ACT-RT-IQ35' }
const base = { productCost: null, bareValveCost: null, lastTotal: null }
const plan = (it: object, m: object | null, act: number | null, gb: number | null, patch = {}) =>
  planActuator({ ...base, ...it } as never, patch, m, GBS, { act: { price: act }, gb: { price: gb } })

test('ACT on a BFV includes the gearbox (the MAPPING row has one)', () => {
  const p = plan({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', bareValveCost: 100 }, BFV500, 50, 30)
  assert.equal(p.gbCode, 'GB-AU-125.3')
  assert.equal(p.cost.total, 180)
  assert.equal(plan({ itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', bareValveCost: 100 }, BFV500, 50, null).cost.total, null) // GB price missing: pending
})

test('direct MAPPING row (SLUICE-RS) costs actuator only and is not stuck pending for a gearbox', () => {
  const p = plan({ itemType: 'SLUICE VALVE-RESILIENT-RISING', size: '700', pnRating: 'PN-10', bareValveCost: 100 }, DIRECT, 40, null)
  assert.equal(p.gbCode, null)
  assert.deepEqual(p.cost.pending, [])
  assert.equal(p.cost.total, 140)
  assert.equal(plan({ itemType: 'SLUICE VALVE-RESILIENT-RISING', size: '700', pnRating: 'PN-10', bareValveCost: 100 }, DIRECT, null, null).cost.total, null) // actuator price missing
})

test('ACTUATOR item with a non-ACT Op Type: actuator + gearbox per the mapping, no bare valve', () => {
  const it = { itemType: 'ACTUATOR', itemName: 'Actuator for BFV', size: '500', pnRating: 'PN-16', operationType: 'STANDARD', bareValveCost: 999 }
  assert.equal(plan(it, BFV500, 50, 30).cost.total, 80)
  assert.equal(plan({ ...it, size: '700' }, DIRECT, 40, null).cost.total, 40) // direct row: actuator only
})

test('Update BOM Costs on a pending actuated item: the refilled valve cost never becomes the total', () => {
  // recalculateItem hands every non-actuator productCost write to this plan as the valve cost; ACT price is blank.
  const refilled = { itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', operationType: 'ACT+GB', productCost: 100000 }
  const pending = plan(refilled, BFV500, null, 30)
  assert.equal(pending.cost.total, null)
  assert.equal(pending.bare, 100000) // kept for when the price arrives
  // price arrives, next run: productCost was blanked, bare comes from the stored value
  const priced = plan({ ...refilled, productCost: null, bareValveCost: 100000 }, BFV500, 50000, 30000)
  assert.equal(priced.cost.total, 180000)
  // a re-run on the priced item does not count the total as the valve cost
  assert.equal(plan({ ...refilled, productCost: 180000, bareValveCost: 100000, lastTotal: 180000 }, BFV500, 50000, 30000).cost.total, 180000)
})

test('productCost + other fields on an actuated item: the other fields are kept for the normal path', () => {
  assert.deepEqual(withoutProductCost({ productCost: 100, quotedRate: 250 }), { quotedRate: 250 })
  assert.deepEqual(withoutProductCost({ productCost: 100, extension: '1m', bypass: null, quantity: 2, vaPercent: 30 }), { extension: '1m', bypass: null, quantity: 2, vaPercent: 30 })
  assert.equal(withoutProductCost({ productCost: 100 }), null)
  assert.equal(withoutProductCost({ productCost: 100, quotedRate: undefined }), null)
})

// ---- final-review fixes: link test, re-pricing on spec change --------------------------------------------------
type St = { itemType: string; size: string; pnRating: string; operationType: string; productCost: number | null; bareValveCost: number | null; lastTotal: number | null; actCode: string | null; gbCode: string | null; actuatorBreakdown: unknown }
const MAPS: Record<string, object> = { 'BFV|500|PN16': BFV500, 'SLUICE-RS|700|PN10': DIRECT }
// Mirrors syncActuatorOnChange + applyActuatorToItem: what ends up stored.
function run(it: St, before: St, price = { act: 50, gb: 30 }): St {
  if (!isActuatorCandidate(it)) {
    if (!hasActuatorLink(it)) return it
    return { ...it, productCost: bareValveOf(it), bareValveCost: null, lastTotal: null, actCode: null, gbCode: null, actuatorBreakdown: null }
  }
  const linked = hasActuatorLink(it)
  if (!linked && isActuatorCandidate(before)) return it // legacy row: untouched
  const key = deriveMapKey(it)!
  const p = planActuator(it as never, linked && deriveMapKey(before) !== key ? { rederive: true } : {}, MAPS[key] ?? null, GBS, { act: { price: price.act }, gb: { price: price.gb } })
  return { ...it, actCode: p.actCode, gbCode: p.gbCode, bareValveCost: p.bare, lastTotal: p.cost.total, productCost: p.cost.total, actuatorBreakdown: p.cost }
}
const MAN: St = { itemType: 'BUTTERFLY VALVE', size: '500', pnRating: 'PN-16', operationType: 'MANUAL', productCost: 100, bareValveCost: null, lastTotal: null, actCode: null, gbCode: null, actuatorBreakdown: null }

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
  const pending = run({ ...MAN, operationType: 'ACT' }, MAN, { act: null as never, gb: null as never })
  assert.equal(pending.productCost, null)
  assert.equal(isActuated(pending), true)
  const refilled = run({ ...pending, productCost: 100 }, pending, { act: null as never, gb: null as never }) // BOM fill writes the valve cost
  assert.equal(refilled.productCost, null) // still blank while a price is pending
  assert.equal(refilled.bareValveCost, 100)
})

test('manual -> ACT: valve cost kept as bare, parts added once', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  assert.equal(act.productCost, 180)
  assert.equal(act.bareValveCost, 100)
  assert.equal(act.actCode, 'ACT-AU-SA14.2')
})

test('ACT -> manual restores the bare valve cost and clears the breakdown', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const back = run({ ...act, operationType: 'MANUAL' }, act)
  assert.equal(back.productCost, 100)
  assert.deepEqual([back.actCode, back.gbCode, back.bareValveCost, back.actuatorBreakdown], [null, null, null, null])
  assert.equal(isActuated(back), false)
})

test('DN change re-derives the codes from the new MAP KEY and re-prices', () => {
  const act = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const moved = run({ ...act, itemType: 'SLUICE VALVE-RESILIENT-RISING', size: '700', pnRating: 'PN-10' }, act)
  assert.equal(moved.actCode, 'ACT-AU-SA14.6')
  assert.equal(moved.gbCode, null) // direct row: no gearbox
  assert.equal(moved.productCost, 150) // bare 100 + DIRECT actuator 50, built from bareValveCost not the old total
  // MAP KEY unchanged (Op Type ACT -> ACT+GB): a hand-set code is kept
  const hand = { ...act, actCode: 'ACT-HAND' }
  assert.equal(run({ ...hand, operationType: 'ACT' }, hand).actCode, 'ACT-HAND')
})

test('ACT -> manual -> ACT never double counts', () => {
  const a1 = run({ ...MAN, operationType: 'ACT+GB' }, MAN)
  const m = run({ ...a1, operationType: 'MANUAL' }, a1)
  const a2 = run({ ...m, operationType: 'ACT+GB' }, m)
  assert.equal(a1.productCost, 180)
  assert.equal(a2.productCost, 180)
  assert.equal(a2.bareValveCost, 100)
})
