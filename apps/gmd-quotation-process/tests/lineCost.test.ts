import test from 'node:test'
import assert from 'node:assert/strict'
import { receiptRate, unitCost, type CostBook, type Receipt } from '../lib/lineCost.js'

/** 'dd-mm-yyyy' -> the receipt-day key the loader builds (UTC midnight). */
const day = (d: string) => Date.UTC(+d.slice(6), +d.slice(3, 5) - 1, +d.slice(0, 2))
const bought = (qty: number, rate: number, on: string): Receipt => ({ at: day(on), qty, value: qty * rate })
const MISSING = { unitCost: null, basis: null }

const trading = [bought(10, 11_700, '01-08-2026'), bought(5, 12_000, '01-10-2026')]

test('trading: the latest receipt day on or before the sale, else the first after', () => {
  const book: CostBook = { receipts: new Map([['TV-1', trading]]), boms: new Map() }
  assert.deepEqual(unitCost('TV-1', day('15-09-2026'), book), { unitCost: 11_700, basis: 'Purchase' })
  assert.deepEqual(unitCost('TV-1', day('15-10-2026'), book), { unitCost: 12_000, basis: 'Purchase' })
  assert.deepEqual(unitCost('TV-1', day('01-06-2026'), book), { unitCost: 11_700, basis: 'Purchase' })
  // a receipt on the invoice day counts as "on or before"
  assert.equal(receiptRate(trading, day('01-10-2026')), 12_000)
})

test('receipts on the same day are qty-weighted', () => {
  assert.equal(receiptRate([bought(1, 100, '01-08-2026'), bought(3, 200, '01-08-2026')], day('02-08-2026')), 175)
})

test('manufactured: BOM qty x part rate, from the highest-numbered open BOM', () => {
  const book: CostBook = {
    receipts: new Map([
      ['BODY', [bought(1, 4_000, '01-08-2026')]],
      ['DISC', [bought(1, 600, '01-08-2026')]],
      ['BOLT', [bought(10, 100, '01-08-2026')]],
    ]),
    boms: new Map([['FSD040001', [
      { bomId: 'BOM-9', code: 'NEVER-BOUGHT', qty: 1 }, // older BOM: BOM-11 outranks it
      { bomId: 'BOM-11', code: 'BODY', qty: 1 },
      { bomId: 'BOM-11', code: 'DISC', qty: 1 },
      { bomId: 'BOM-11', code: 'BOLT', qty: 2.5 },
    ]]]),
  }
  assert.deepEqual(unitCost('FSD040001', day('15-09-2026'), book), { unitCost: 4_850, basis: 'BOM' })
})

test('a one-line M2M BOM costs its bought part', () => {
  const book: CostBook = { receipts: new Map([['TV-1', trading]]), boms: new Map([['FSD010001', [{ bomId: 'BOM-1', code: 'TV-1', qty: 1 }]]]) }
  assert.deepEqual(unitCost('FSD010001', day('15-09-2026'), book), { unitCost: 11_700, basis: 'BOM' })
})

test('a part never bought, or a missing qty, makes the cost missing, never zero', () => {
  const receipts = new Map([['BODY', [bought(1, 4_000, '01-08-2026')]]])
  const at = day('15-09-2026')
  assert.deepEqual(unitCost('NEVER', at, { receipts, boms: new Map() }), MISSING)
  assert.deepEqual(unitCost('FSD1', at, { receipts, boms: new Map([['FSD1', [{ bomId: 'B', code: 'BODY', qty: 1 }, { bomId: 'B', code: 'NEVER', qty: 1 }]]]) }), MISSING)
  assert.deepEqual(unitCost('FSD1', at, { receipts, boms: new Map([['FSD1', [{ bomId: 'B', code: 'BODY', qty: null }]]]) }), MISSING)
  // a linked part whose code is blank (the loader keeps it) has no rate either
  assert.deepEqual(unitCost('FSD1', at, { receipts, boms: new Map([['FSD1', [{ bomId: 'B', code: 'BODY', qty: 1 }, { bomId: 'B', code: '', qty: 1 }]]]) }), MISSING)
  // a BOM that lists its own item stops at the depth limit instead of looping
  assert.deepEqual(unitCost('FSD1', at, { receipts, boms: new Map([['FSD1', [{ bomId: 'B', code: 'FSD1', qty: 1 }]]]) }), MISSING)
})

test('a failed cost load leaves every line cost missing, never zero, and logs once', async (t) => {
  // @gmd/db-quotation and @gmd/db-stock reuse these globals when set, so no DB is touched.
  const g = globalThis as unknown as { quotationPrisma: unknown; stockPrisma: unknown }
  g.quotationPrisma = { bom: { findMany: async () => [] }, enquiryItem: { findMany: async () => [] } }
  g.stockPrisma = { grnLine: { findMany: async () => { throw new Error('stock DB down') } } }
  const error = t.mock.method(console, 'error', () => {})
  const { costLines } = await import('../lib/lineCost-server.js')

  const lines = await costLines([
    { code: 'TV-1', date: null, contractNo: 'C-1' },
    { code: 'FSD1', date: null, contractNo: null },
  ])

  const none = { unitCost: null, basis: null, quotedUnitCost: null }
  assert.deepEqual(lines, [none, none])
  assert.equal(error.mock.callCount(), 1)
})
