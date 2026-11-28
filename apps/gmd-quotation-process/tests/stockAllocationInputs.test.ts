import test from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@gmd/db-quotation'
import { buildStockAllocationInputs } from '../lib/stockAllocationInputs.js'
import type { ContractLine } from '@gmd/stock-allocation/types'

const line = (o: Partial<ContractLine>): ContractLine => ({
  id: 'l', contractNo: 'C1', party: 'P', poNo: null, project: null, dateOfContract: null, itemCode: 'FSD1', itemName: '',
  item: 'SLV', size: '65', pnRating: null, actuator: null, rate: 0, balanceQty: 1, inspection: 'PENDING', offer: 'PENDING', ...o,
})
const part = (bomId: string, erpItemCode: string | null, quantity: number | null, erpQty: unknown = null,
  o: { noUse?: string; l2ValveType?: string; l8ItemCategory?: string } = {}) => ({
  quantity, erpQty, noUse: o.noUse ?? null, bom: { bomId },
  rawMaterial: erpItemCode === null ? null : { erpItemCode, l2ValveType: o.l2ValveType ?? null, l8ItemCategory: o.l8ItemCategory ?? null },
})

test('offered qty is summed over every MC of a contract line; a line with no MC row is left out', () => {
  const inputs = buildStockAllocationInputs(
    [line({ id: 'a', contractNo: 'C1' }), line({ id: 'b', contractNo: 'C2' })],
    [
      { contractNo: 'c1 ', itemCode: 'fsd1', inspOfferedQty: 2 },
      { contractNo: 'C1', itemCode: 'FSD1', inspOfferedQty: 3 },
      { contractNo: 'C1', itemCode: 'FSD1', inspOfferedQty: null }, // an MC line, nothing offered yet
      { contractNo: 'C1', itemCode: 'OTHER', inspOfferedQty: 9 },
    ],
    [],
  )
  assert.deepEqual(inputs.offered, { a: 5 })
  assert.deepEqual(inputs.incoming, [])
})

test('major BOM parts per line by its BOM id; a part with no qty counts as one per valve', () => {
  const inputs = buildStockAllocationInputs(
    [line({ id: 'a', bomId: 'B1' }), line({ id: 'b', bomId: null }), line({ id: 'c', bomId: ' b1' })],
    [],
    [
      part('B1', 'RXA010001', 1),
      part('B1', 'RSS010001', 2, new Prisma.Decimal('2.5')), // the ERP's fractional qty wins, as in the cost engine
      part('B1', 'RZZ000001', null),
      part('B1', null, 1), // no raw material code: skipped
      part('B2', 'RXA010009', 1),
    ],
  )
  const b1 = [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 2.5 }, { erpCode: 'RZZ000001', qty: 1 }]
  assert.deepEqual(inputs.boms, { a: b1, c: b1 })
})

test('BOM lines closed as NO USE, and actuator or gearbox lines, are not RM-route parts', () => {
  const inputs = buildStockAllocationInputs([line({ id: 'a', bomId: 'B1' })], [], [
    part('B1', 'RXA010001', 1),
    part('B1', 'RSS010001', 1, null, { noUse: ' no use ' }), // replaced by RSS010007 in a BOM edit
    part('B1', 'RSS010007', 1),
    part('B1', 'RAA010001', 1, null, { l8ItemCategory: 'ACTUATORS' }), // the line's approved actuator is held by rule h
    part('B1', 'RGB010001', 1, null, { l2ValveType: 'GEAR BOX' }), // gearbox availability shows on its own
  ])
  assert.deepEqual(inputs.boms, { a: [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010007', qty: 1 }] })
})
