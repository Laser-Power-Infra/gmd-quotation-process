import test from 'node:test'
import assert from 'node:assert/strict'
import { addLine, emptyCell, fiscalMonths, gpOf, lightOf, monthKey, producedSummary, saleMoney, stageOf, valveTypeOf } from '../lib/executionPages.js'
import { minVaPercent } from '../lib/vaRules.js'

const base = { orderQty: 10, prodOrdQty: 0, diQty: 0, billedQty: 0, productionOrderNumber: null, offerNumber: [], inspectionNumber: [], diDate: [] }

test('stageOf walks order -> done', () => {
  assert.equal(stageOf(base), 'Order')
  assert.equal(stageOf({ ...base, prodOrdQty: 10 }), 'Production')
  assert.equal(stageOf({ ...base, prodOrdQty: 10, offerNumber: ['O1'] }), 'Inspection')
  assert.equal(stageOf({ ...base, offerNumber: ['O1'], inspectionNumber: ['I1'] }), 'Dispatch')
  assert.equal(stageOf({ ...base, inspectionNumber: ['I1'], diQty: 10, billedQty: 4 }), 'Bill')
  assert.equal(stageOf({ ...base, diQty: 10, billedQty: 10 }), 'Done')
})

test('Order Status per contract: produced X of Y over the lines with a known entry qty, with the last entry day', () => {
  assert.equal(
    producedSummary([
      { prodOrdQty: 10, prodEntryQty: 6, prodEntryDate: '03-Jan-2024' },
      { prodOrdQty: 5, prodEntryQty: 2, prodEntryDate: '15-Feb-2024' },
      { prodOrdQty: 7, prodEntryQty: null, prodEntryDate: null }, // balance unknown: in neither total
    ]),
    'Produced 8 of 15 (last entry 15-Feb-2024)',
  )
  assert.equal(producedSummary([{ prodOrdQty: 4, prodEntryQty: 4, prodEntryDate: null }]), 'Produced 4 of 4')
  assert.equal(producedSummary([{ prodOrdQty: 7, prodEntryQty: null, prodEntryDate: null }]), null)
  // No production order qty yet (sheet 0 - 0): nothing to report, not "Produced 0 of 0".
  assert.equal(producedSummary([{ prodOrdQty: 0, prodEntryQty: 0, prodEntryDate: null }]), null)
})

test('lightOf', () => {
  assert.equal(lightOf('Bill', 30), 'green')
  assert.equal(lightOf('Bill', 90), 'amber')
  assert.equal(lightOf('Bill', 200), 'red')
  assert.equal(lightOf('Done', 200), 'green')
})

test('monthKey and fiscalMonths', () => {
  assert.equal(monthKey('12-Apr-26'), '2026-04')
  assert.equal(monthKey(''), null)
  const m = fiscalMonths('2026-27')
  assert.equal(m[0], '2026-04')
  assert.equal(m[11], '2027-03')
})

test('valve type: item master first', () => {
  assert.equal(valveTypeOf('SLUICE VALVE-METAL-NON-RISING', 'Gate Valve'), 'SLUICE VALVE-METAL-NON-RISING')
  // no item-master type: the sheet label is read through the keyword patterns
  assert.equal(valveTypeOf(null, 'Gate Valve'), 'SLUICE VALVE-RESILIENT-RISING')
  assert.equal(valveTypeOf('  ', 'XYZ'), 'XYZ')
  assert.equal(valveTypeOf(undefined, ''), '-')
})

const line = (value: number, cost: number | null, minVa = 0, quotedCost: number | null = null) => ({ value, cost, minVa, quotedCost })
const cellOf = (...lines: ReturnType<typeof line>[]) => lines.reduce(addLine, emptyCell())

test('cost missing: its sales count, but GP and GP % cover only the costed lines', () => {
  const c = cellOf(line(100_000, 80_000), line(50_000, null))
  assert.equal(c.sales, 150_000)
  assert.equal(c.missingSales, 50_000)
  assert.equal(c.missingLines, 1)
  const g = gpOf(c)
  assert.equal(g.gp, 20_000)
  assert.equal(g.gpPct, 20) // not 13.3 (missing as zero GP), not 46.7 (missing as zero cost)
  // only missing lines: no GP at all, never 100%
  assert.deepEqual(gpOf(cellOf(line(50_000, null))), { gp: null, gpPct: null, red: false, quotedGpPct: null })
  // quoted GP % is over the lines the Quotation app has a cost for
  assert.equal(gpOf(cellOf(line(100_000, 80_000, 0, 75_000), line(50_000, null))).quotedGpPct, 25)
})

test('a blank sales value is cost missing, never costed against ₹0 of sales', () => {
  assert.deepEqual(saleMoney('10', '12,000', 1_000, 900), { qty: 10, value: 12_000, cost: 10_000, quotedCost: 9_000 })
  // SALE BILL inserts carry qty and code but no value until MASTER covers the row
  assert.deepEqual(saleMoney('10', null, 1_000, 900), { qty: 10, value: 0, cost: null, quotedCost: null })
  assert.deepEqual(saleMoney('10', ' ', 1_000, null), { qty: 10, value: 0, cost: null, quotedCost: null })
  const unpriced = { ...saleMoney('10', null, 1_000, null), minVa: 0 }
  const c = cellOf(line(100_000, 80_000), unpriced)
  assert.equal(gpOf(c).gpPct, 20) // no phantom loss
  assert.equal(c.missingLines, 1)
})

test('weighted: the All row adds the lines, never averages the percentages', () => {
  assert.equal(gpOf(cellOf(line(100, 50))).gpPct, 50)
  assert.equal(gpOf(cellOf(line(900, 810))).gpPct, 10)
  assert.equal(gpOf(cellOf(line(100, 50), line(900, 810))).gpPct, 14) // not 30
})

// VA% is a mark-up on cost (rate = cost × (1 + VA/100)), so the GP floor is sales × VA ÷ (100 + VA):
// 15% on cost = 13.0% of sales, 30% = 23.1%, 100% = 50%.
test('red: GP below the minimum VA% of the valve type, sales-weighted', () => {
  const resilient = minVaPercent({ itemType: 'SLUICE VALVE-RESILIENT-NON-RISING' })
  const metal = minVaPercent({ itemType: 'SLUICE VALVE-METAL-NON-RISING' })
  assert.equal(gpOf(cellOf(line(100_000, 87_700, resilient))).red, true) // GP 12.3% of sales < 13.0%
  assert.equal(gpOf(cellOf(line(100_000, 83_300, resilient))).red, false) // 16.7% >= 13.0%
  assert.equal(gpOf(cellOf(line(100_000, 83_300, metal))).red, true) // 16.7% < 23.1%
  // mixed cell: GP 33,400 against a floor of 13,043 + 23,077
  assert.equal(gpOf(cellOf(line(100_000, 83_300, resilient), line(100_000, 83_300, metal))).red, true)
})

test('red floor reads VA% as a mark-up on cost: a plug valve at 90% GP is not red; a sale at the minimum sits on the line', () => {
  const plug = minVaPercent({ itemType: 'PLUG VALVE' }) // 100% on cost = 50% GP
  assert.equal(gpOf(cellOf(line(100_000, 10_000, plug))).red, false)
  // priced exactly at the minimum (cost × 2): floor = GP, not red; a rupee less is red
  const atMin = cellOf(line(100_000, 50_000, plug))
  assert.equal(atMin.minGp, 50_000)
  assert.equal(gpOf(atMin).red, false)
  assert.equal(gpOf(cellOf(line(99_999, 50_000, plug))).red, true)
  // the same for 15%: cost 1,00,000 sold at 1,15,000
  const resilient = minVaPercent({ itemType: 'SLUICE VALVE-RESILIENT-NON-RISING' })
  assert.equal(gpOf(cellOf(line(115_000, 100_000, resilient))).red, false)
})
