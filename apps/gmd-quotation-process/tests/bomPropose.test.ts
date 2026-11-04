import test from 'node:test'
import assert from 'node:assert/strict'
import { pickNearest, similarity } from '../lib/bomPropose.js'

const base = { itemType: 'SLUICE VALVE', size: '100', moc: 'DI', pnGmd: 'PN16', operation: 'MANUAL' }

test('nearest approved BOM needs type + size, prefers more matching attributes', () => {
  const target = { itemCode: 'FBS000001', ...base }
  const sameAll = { itemCode: 'FBS000002', ...base }
  const otherMoc = { itemCode: 'FBS000003', ...base, moc: 'CI' }
  const otherSize = { itemCode: 'FBS000004', ...base, size: '150' }
  assert.equal(pickNearest(target, [otherMoc, sameAll, otherSize])?.itemCode, 'FBS000002')
  assert.equal(pickNearest(target, [otherMoc])?.itemCode, 'FBS000003')
  assert.equal(pickNearest(target, [otherSize]), null)
  assert.equal(pickNearest(target, [sameAll, { ...target }])?.itemCode, 'FBS000002')
  assert.ok(similarity(target, sameAll) > similarity(target, otherMoc))
})
