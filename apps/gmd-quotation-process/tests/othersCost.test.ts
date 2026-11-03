import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeOthersCostFromRows,
  firstNumberKey,
  mocKey,
  type FlangeCostRow,
  type GasketCostRow,
} from '../lib/othersCost.js'
import { evaluateCostWarnings, COST_WARNING } from '../lib/costSanity.js'

const flange = (over: Partial<FlangeCostRow> = {}): FlangeCostRow => ({
  size: '50',
  moc: 'CI',
  pnRatingClass: '10',
  costAsPerIs: '500',
  boltCost: '20',
  nutCost: '10',
  ...over,
})

const gasket = (over: Partial<GasketCostRow> = {}): GasketCostRow => ({
  l3Dia: '50MM',
  l4Component: 'GASKET',
  cost: 100,
  ...over,
})

const item = (others: string[], over: Partial<{ size: string | null; moc: string | null; pnRating: string | null }> = {}) => ({
  others,
  size: 'DN 50',
  moc: 'C.I.',
  pnRating: 'PN10',
  ...over,
})

test('normalizers', () => {
  assert.equal(firstNumberKey('DN 50'), '50')
  assert.equal(firstNumberKey('300MM'), '300')
  assert.equal(firstNumberKey('PN-10/16'), '10')
  assert.equal(firstNumberKey(''), null)
  assert.equal(mocKey('C.I.'), 'CI')
  assert.equal(mocKey('Cast Iron'), 'CI')
  assert.equal(mocKey('  d.i. '), 'DI')
})

test('combined item MOC matches either half', () => {
  const rows = [flange({ moc: 'DI', costAsPerIs: '700' }), flange({ moc: 'CI', costAsPerIs: '600' })]
  const res = computeOthersCostFromRows(item(['flange'], { moc: 'DUCTILE IRON/CAST IRON' }), rows, [])
  assert.deepEqual(res, { cost: 700, complete: true }) // costliest of the two halves
  assert.equal(computeOthersCostFromRows(item(['flange'], { moc: 'GUN METAL/ BRASS' }), rows, []).complete, false)
})

test('multipliers: F=1, G=2, B=2, N=1', () => {
  const rows = [flange()]
  const gaskets = [gasket()]
  assert.deepEqual(computeOthersCostFromRows(item(['flange']), rows, gaskets), { cost: 500, complete: true })
  assert.deepEqual(computeOthersCostFromRows(item(['nut and bolt']), rows, gaskets), { cost: 2 * 20 + 10, complete: true })
  assert.deepEqual(computeOthersCostFromRows(item(['gasket']), rows, gaskets), { cost: 200, complete: true })
  assert.deepEqual(
    computeOthersCostFromRows(item(['flange', 'gasket', 'nut and bolt']), rows, gaskets),
    { cost: 500 + 200 + 50, complete: true },
  )
})

test('matching normalizes size, MOC and PN formats', () => {
  const rows = [flange({ size: '50 MM', moc: 'CAST IRON', pnRatingClass: 'PN 10' })]
  assert.deepEqual(computeOthersCostFromRows(item(['flange']), rows, []), { cost: 500, complete: true })
  // wrong size / moc / pn -> no match
  assert.equal(computeOthersCostFromRows(item(['flange'], { size: '80' }), rows, []).complete, false)
  assert.equal(computeOthersCostFromRows(item(['flange'], { moc: 'DI' }), rows, []).complete, false)
  assert.equal(computeOthersCostFromRows(item(['flange'], { pnRating: 'PN16' }), rows, []).complete, false)
  // item without PN rating matches any PN
  assert.equal(computeOthersCostFromRows(item(['flange'], { pnRating: null }), rows, []).complete, true)
})

test('costliest match wins', () => {
  const rows = [flange({ costAsPerIs: '400' }), flange({ costAsPerIs: '650' })]
  assert.equal(computeOthersCostFromRows(item(['flange']), rows, []).cost, 650)
  const gaskets = [gasket({ cost: 90 }), gasket({ cost: 120 }), gasket({ l4Component: 'BODY GASKET', cost: 999 })]
  // BODY GASKET is not plain GASKET -> excluded
  assert.equal(computeOthersCostFromRows(item(['gasket']), [], gaskets).cost, 240)
})

test('missing component cost -> partial sum, complete=false', () => {
  const rows = [flange({ boltCost: null })]
  const res = computeOthersCostFromRows(item(['flange', 'nut and bolt']), rows, [])
  assert.equal(res.cost, 500) // flange found, nut-bolt missing
  assert.equal(res.complete, false)
  // no others ticked -> zero and complete
  assert.deepEqual(computeOthersCostFromRows(item([]), rows, []), { cost: 0, complete: true })
})

test('cost warning fires when others are ticked but othersCost is null', () => {
  const base = { enquiryId: 'e', itemType: 'SV', moc: 'CI', size: '50', productCost: 1000 }
  const warned = evaluateCostWarnings([{ ...base, id: 'a', others: ['flange'], othersCost: null }])
  assert.ok(warned.get('a')?.includes(COST_WARNING.OTHERS_COST_MISSING))
  const ok = evaluateCostWarnings([
    { ...base, id: 'b', others: ['flange'], othersCost: 500 },
    { ...base, id: 'c', others: [], othersCost: null },
  ])
  assert.ok(!ok.get('b')?.includes(COST_WARNING.OTHERS_COST_MISSING))
  assert.ok(!ok.get('c')?.includes(COST_WARNING.OTHERS_COST_MISSING))
})
