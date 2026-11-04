import test from 'node:test'
import assert from 'node:assert/strict'
import { COST_BASIS, costBasisOf, headOf, parseHeadMap, UNCLASSIFIED_HEAD } from '../lib/gmd_lib/majorHead.js'
import { getCastingKey } from '../lib/gmd_lib/rawMaterialView.js'

test('every L8 maps to exactly one head; blank and unknown are UNCLASSIFIED', () => {
  const map = parseHeadMap(['CASTING=CASTINGS & PATTERNS', 'spares = MACHINED SPARES', 'bad-row'])
  assert.equal(headOf(map, ' casting '), 'CASTINGS & PATTERNS')
  assert.equal(headOf(map, 'SPARES'), 'MACHINED SPARES')
  assert.equal(headOf(map, ''), UNCLASSIFIED_HEAD)
  assert.equal(headOf(map, null), UNCLASSIFIED_HEAD)
  assert.equal(headOf(map, 'L8 -ITEM CATEGORY'), UNCLASSIFIED_HEAD)
})

test('cost basis: castings need a weight, everything else a supplier price', () => {
  assert.equal(costBasisOf(true, '12.5', null), COST_BASIS.weight)
  assert.equal(costBasisOf(true, '', 100), COST_BASIS.weightMissing)
  assert.equal(costBasisOf(true, '0', 100), COST_BASIS.weightMissing)
  assert.equal(costBasisOf(false, '', 100), COST_BASIS.supplier)
  assert.equal(costBasisOf(false, '5', null), COST_BASIS.missing)
})

test('casting key covers every L5 material under CASTING', () => {
  assert.equal(getCastingKey('CASTING', 'DUCTILE IRON'), 'DI')
  assert.equal(getCastingKey('CASTING', 'CAST STEEL'), 'CS')
  assert.equal(getCastingKey('CASTING', 'MILD STEEL'), 'MS')
  assert.equal(getCastingKey('CASTING', 'GALVANISED IRON'), 'GI')
  assert.equal(getCastingKey('CASTING', 'BRONZE/BRASS/GUN METAL'), 'Bronze')
  assert.equal(getCastingKey('CASTING', 'STAINLESS STEEL'), 'SS')
  assert.equal(getCastingKey('SS SPARES', 'STAINLESS STEEL'), 'SS')
  assert.equal(getCastingKey('PATTERN', 'WOOD'), null)
  assert.equal(getCastingKey('CASTING', ''), null)
})
