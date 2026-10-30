import test from 'node:test'
import assert from 'node:assert/strict'
import { missingDetails, pnFromName, sizeFromName } from '../lib/detailsCheck.js'
import { extractSizeFromItemName } from '../lib/sizeExtractor.js'

test('thickness is not read as a size', () => {
  assert.equal(sizeFromName('Gasket 100 mm thk'), null)
  assert.equal(extractSizeFromItemName('Sluice gate 100 mm thk'), null)
  assert.equal(extractSizeFromItemName('Sluice gate 300 mm dia 100 mm thk'), '300')
})

test('explicit diameter and DN are detected', () => {
  assert.equal(sizeFromName('Valve 150 mm dia'), '150')
  assert.equal(sizeFromName('Valve DN 200'), '200')
  assert.equal(sizeFromName('Valve 250 NB'), '250')
  assert.equal(sizeFromName('Valve with 16 bar'), null)
})

test('PN comes from PN text or kg/cm2', () => {
  assert.equal(pnFromName('Valve PN 1.6'), 'PN-10/16')
  assert.equal(pnFromName('Valve 16 kg/cm²'), 'PN-10/16')
  assert.equal(pnFromName('Valve 10 kg/cm2'), 'PN-10/16')
  assert.equal(pnFromName('Valve plain'), null)
})

test('missingDetails counts blank, UNKNOWN and undetectable size', () => {
  assert.deepEqual(
    missingDetails({ itemType: 'UNKNOWN', moc: 'CI', size: 'Not detectable', pnRating: '', operationType: 'GB' }),
    ['itemType', 'size', 'pnRating'],
  )
  assert.deepEqual(
    missingDetails({ itemType: 'GATE', moc: 'CI', size: '100', pnRating: 'PN-10/16', operationType: 'GB' }),
    [],
  )
})
