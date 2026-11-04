import test from 'node:test'
import assert from 'node:assert/strict'
import { BOM_TYPE, classifyBom, storedTypeDisagrees, type BomLine } from '../lib/bomClassify.js'
import { bomMismatches, isHardIssue, normalizeSize } from '../lib/bomMismatch.js'

const rm = (code: string, open = true, name?: string): BomLine => ({ code, name, isFullItem: false, open })
const fg = (code: string, open = true): BomLine => ({ code, isFullItem: true, open })

test('classifyBom: the six shapes plus closed and empty', () => {
  assert.equal(classifyBom([rm('RTV010001', true, 'TV-SLUICE VALVE 100MM')]), BOM_TYPE.m2m)
  assert.equal(classifyBom([rm('TV-000123')]), BOM_TYPE.m2m)
  assert.equal(classifyBom([fg('FBS040002')]), BOM_TYPE.fgSubstitute)
  assert.equal(classifyBom([rm('RSD080005', true, 'DI BODY 100MM')]), BOM_TYPE.otherRm)
  assert.equal(classifyBom([rm('A'), rm('B')]), BOM_TYPE.twoToOne)
  assert.equal(classifyBom([rm('A'), rm('B'), rm('C')]), BOM_TYPE.threeToOne)
  assert.equal(classifyBom([rm('A'), rm('B'), rm('C'), rm('D')]), BOM_TYPE.production)
  // closed lines do not count; a BOM with only closed lines is Closed
  assert.equal(classifyBom([rm('A'), rm('B', false)]), BOM_TYPE.otherRm)
  assert.equal(classifyBom([rm('A', false)]), BOM_TYPE.closed)
  assert.equal(classifyBom([]), BOM_TYPE.empty)
})

test('stored BOM ID TYPE disagreement', () => {
  assert.equal(storedTypeDisagrees(BOM_TYPE.twoToOne, '2:1'), false)
  assert.equal(storedTypeDisagrees(BOM_TYPE.twoToOne, 'DIRECT M2M'), true)
  assert.equal(storedTypeDisagrees(BOM_TYPE.m2m, ''), false)
  assert.equal(storedTypeDisagrees(BOM_TYPE.otherRm, 'CREATE BOM'), false)
})

test('size mismatch examples from the task mail', () => {
  // G2-C0004-55: FBC010153 (900MM) mapped to a 3000MM code
  const a = bomMismatches(
    { name: 'BUTTERFLY VALVE 900MM DI PN10', size: '900MM', moc: 'DI' },
    { name: 'BUTTERFLY VALVE 3000MM DI PN10', size: '3000', moc: 'DI' },
  )
  assert.deepEqual(a, ['Size 900 vs 3000'])
  // G2-C0013-30: FBS040002 125MM mapped to a 100MM TV code
  const b = bomMismatches(
    { name: 'SLUICE VALVE 125MM', size: '125' },
    { name: 'TV-SLUICE VALVE 100 MM CI PN16' },
  )
  assert.ok(b.includes('Size 125 vs 100'), b.join(';'))
})

test('CI->DI is an allowed substitution, other MOCs are not', () => {
  const subst = bomMismatches({ size: '100', moc: 'CI' }, { size: '100', moc: 'DUCTILE IRON' })
  assert.deepEqual(subst, ['MOC subst CI->DI'])
  assert.equal(subst.every(isHardIssue), false)
  const hard = bomMismatches({ size: '100', moc: 'CI' }, { size: '100', moc: 'STAINLESS STEEL' })
  assert.deepEqual(hard, ['MOC CI vs STAINLESS STEEL'])
  assert.equal(hard.every(isHardIssue), true)
})

test('normalizeSize', () => {
  assert.equal(normalizeSize('900MM'), '900')
  assert.equal(normalizeSize('900'), '900')
  assert.equal(normalizeSize('DN 150'), '150')
  assert.equal(normalizeSize(''), null)
})
