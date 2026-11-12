import test from 'node:test'
import assert from 'node:assert/strict'
import { SUPPLY_BOM_COST_HEADER, SUPPLY_DISPLAY_HEADERS, SUPPLY_RM_COST_HEADER, buildSupplyRow, type SupplyRowSource } from '../lib/supplyRows.js'

const BOM = SUPPLY_DISPLAY_HEADERS.indexOf(SUPPLY_BOM_COST_HEADER)
const RM = SUPPLY_DISPLAY_HEADERS.indexOf(SUPPLY_RM_COST_HEADER)
const item = (over: Partial<SupplyRowSource> = {}) => ({ id: 'r1', bomLinks: [], selectedBomItem: null, ...over }) as SupplyRowSource

test('supply costs: the engine fills only empty cells, BOM basis in BOM COST, purchase in RAWMATERIAL COST', () => {
  const bom = buildSupplyRow(item(), { unitCost: 4850.456, basis: 'BOM' }).row
  assert.equal(bom[BOM], '4850.46')
  assert.equal(bom[RM], null)
  const bought = buildSupplyRow(item(), { unitCost: 11_700, basis: 'Purchase' }).row
  assert.equal(bought[RM], '11700')
  assert.equal(bought[BOM], null)
  // the linked BOM item's own cost stays
  const linked = item({ bomLinks: [{ bomItemId: 'b1', bom: { bomId: 'BOM-1' }, bomItem: { cost: 5000 }, rawMaterial: null }] })
  assert.equal(buildSupplyRow(linked, { unitCost: 4850, basis: 'BOM' }).row[BOM], '5000')
  // cost missing: the cell stays blank, never 0
  assert.equal(buildSupplyRow(item(), { unitCost: null, basis: null }).row[BOM], null)
})
