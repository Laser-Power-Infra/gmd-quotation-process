import test from 'node:test'
import assert from 'node:assert/strict'
import { planContractPhysicalStock, resolveContractPhysicalStock, sumTablePhysicalStock } from '../lib/contractPhysicalStock.js'
import { computeContractReviewRmAvail, scarcestPartStock } from '../lib/verifyBomLookup.js'

// Puja 18 Nov: these three 80 mm lines all showed 653, the stock of the one RM
// code their costCodeRef shares. SLV / TPAV stand in for those shared RM codes.
const SLV = 'TSL080001'
const TPAV = 'TPA080001'
const stockPhys = { FSD040044: '12', FGD060027: '0', FVD010006: '5', [SLV]: '653', [TPAV]: '40' }

test('three lines sharing one costCodeRef each show their own FG stock', () => {
  const rows = [
    { id: 'manual', itemCode: 'FSD040044', costCodeRef: SLV },
    { id: 'motorised', itemCode: 'FGD060027', costCodeRef: SLV },
    { id: 'airValve', itemCode: 'FVD010006', costCodeRef: SLV },
  ]
  const plan = planContractPhysicalStock(rows, stockPhys)
  assert.equal(plan.get('manual'), '12')
  assert.equal(plan.get('motorised'), '0')
  assert.equal(plan.get('airValve'), '5')
  assert.ok(![...plan.values()].includes('653'), 'no line shows the shared RM total')
})

test('an item code with no stock-phys row gets the empty value, never another item figure', () => {
  const rows = [
    { id: 'unknown', itemCode: 'FSD999999', costCodeRef: SLV },
    { id: 'blank', itemCode: '', costCodeRef: SLV },
  ]
  const plan = planContractPhysicalStock(rows, stockPhys)
  assert.equal(plan.get('unknown'), null)
  assert.equal(plan.get('blank'), null)
})

test('a comma-separated costCodeRef no longer leaks into the figure', () => {
  // The old lookup added TPAV + SLV: 40 + 653 = 693.
  const rows = [{ id: 'airValve', itemCode: 'FVD010006', costCodeRef: `${TPAV}, ${SLV}` }]
  assert.equal(planContractPhysicalStock(rows, stockPhys).get('airValve'), '5')
})

test('item codes are matched case-insensitively and trimmed', () => {
  const plan = planContractPhysicalStock([{ id: 'c1', itemCode: ' fsd040044 ' }], stockPhys)
  assert.equal(plan.get('c1'), '12')
})

test('a comma-formatted stock is read as a number; a non-numeric one is blank', () => {
  const plan = planContractPhysicalStock(
    [
      { id: 'commas', itemCode: 'FSD040044' },
      { id: 'text', itemCode: 'FGD060027' },
    ],
    { FSD040044: '1,234.5', FGD060027: 'N/A' },
  )
  assert.equal(plan.get('commas'), '1234.5')
  assert.equal(plan.get('text'), null)
})

// Puja 20 Nov: the figure is the Physical Stock page's table; the sheet is only a fallback.
const table = sumTablePhysicalStock([
  { erp_code: 'FSD040044', available_qty: '7' },
  { erp_code: ' fsd040044 ', available_qty: '1,000.5' }, // second location / duplicate, other case + spaces
  { erp_code: 'FGD060027', available_qty: '' }, // blank: ignored
  { erp_code: 'FVD010006', available_qty: 'N/A' }, // non-numeric: ignored
  { erp_code: null, available_qty: '9' },
])

test('table figure wins over the sheet and sums rows of one code (case / spaces ignored)', () => {
  assert.deepEqual(table, { FSD040044: 1007.5 })
  const plan = planContractPhysicalStock([{ id: 'a', itemCode: 'FSD040044' }, { id: 'b', itemCode: ' Fsd040044' }], stockPhys, table)
  assert.equal(plan.get('a'), '1007.5') // sheet says 12
  assert.equal(plan.get('b'), '1007.5')
})

test('no usable table row falls back to the sheet figure of the same code, else blank', () => {
  const res = resolveContractPhysicalStock(
    [
      { id: 'blankQty', itemCode: 'FGD060027' }, // table qty blank -> sheet "0"
      { id: 'text', itemCode: 'FVD010006' }, // table qty text -> sheet "5"
      { id: 'neither', itemCode: 'FSD999999' },
    ],
    stockPhys,
    table,
  )
  assert.deepEqual(res.get('blankQty'), { value: '0', source: 'sheet' })
  assert.deepEqual(res.get('text'), { value: '5', source: 'sheet' })
  assert.deepEqual(res.get('neither'), { value: null, source: null })
  assert.equal(resolveContractPhysicalStock([{ id: 'x', itemCode: 'FSD040044' }], {}, table).get('x')?.source, 'table')
})

const part = (availableStock: string | null, noUse: string | null = null) => ({ availableStock, noUse })

test('RM AVAIL is capped by the scarcest BOM part, not the sum of the parts', () => {
  const stock = scarcestPartStock([part('100'), part('3')])
  assert.equal(stock, 3)
  const avail = computeContractReviewRmAvail(
    [
      { id: 'small', bomId: 'B1', orderQty: '2' },
      { id: 'big', bomId: 'B1', orderQty: '5' },
    ],
    new Map([['B1', { qualifies: true, stock }]]),
  )
  assert.equal(avail.get('small'), 'SA')
  assert.equal(avail.get('big'), 'Not available') // the old sum, 103, said SA
})

test('a BOM part with no stock figure is skipped, as before', () => {
  assert.equal(scarcestPartStock([part('1,200'), part(null), part('')]), 1200)
  assert.equal(scarcestPartStock([part(null)]), 0)
})

test('a part with exactly 0 in stock still caps the figure at 0', () => {
  assert.equal(scarcestPartStock([part('0'), part('10')]), 0)
})

test('a BOM line closed in BOM MAST ERP (NO USE) does not cap the live parts', () => {
  // Open A = 50, open B = 40, closed C = 0: the line needs 30, so it is SA, not "Not available".
  const stock = scarcestPartStock([part('50'), part('40'), part('0', 'NO USE')])
  assert.equal(stock, 40)
  const avail = computeContractReviewRmAvail(
    [{ id: 'line', bomId: 'B1', orderQty: '30' }],
    new Map([['B1', { qualifies: true, stock }]]),
  )
  assert.equal(avail.get('line'), 'SA')
  assert.equal(scarcestPartStock([part('50'), part('0', ' no use ')]), 50) // read like the cost engine: trimmed, any case
  assert.equal(scarcestPartStock([part('5', 'NO USE')]), 0) // a fully closed BOM has no live part to build from
})
