import test from 'node:test'
import assert from 'node:assert/strict'
import { matchItemType, correctItemType } from '../lib/itemTypePatterns.js'
import { parseItem } from '../lib/itemVersionResolver.js'
import { validateVaPercent, getDefaultVaPercent } from '../lib/vaValidation.js'

test('TPV item names are detected as TPAV', () => {
  assert.equal(matchItemType('TPV 80mm PN 10'), 'TPAV')
  assert.equal(matchItemType('DI TPV with isolation sluice valve DN 100'), 'TPAV')
  assert.equal(correctItemType('TPV 80mm', 'SLUICE VALVE-RESILIENT-NON-RISING'), 'TPAV')
  // Word boundary: an unrelated word containing "tpv" is not a TPAV.
  assert.notEqual(matchItemType('OUTPVT sluice valve'), 'TPAV')
})

test('TPV resolves to the same indent/contract base item and slot as TPAV', () => {
  for (const [tpv, tpav] of [
    ['TPV', 'TPAV'],
    ['TPV-9523', 'TPAV-9523'],
    ['TPV+SLV', 'TPAV+SLV'],
    ['TPV+RISING SLV-9523', 'TPAV+RISING SLV-9523'],
    ['TPV + SLV METAL RISING - 9523', 'TPAV + SLV METAL RISING - 9523'],
  ]) {
    assert.deepEqual(parseItem(tpv), parseItem(tpav), tpv)
  }
})

test('combined TPV/TPAV + SLV strings resolve to the TPAV+SLV base item', () => {
  const ref = parseItem('TPAV+SLV')
  for (const s of ['TPV + SLV METAL RISING - 9523', 'TPV+SLV', 'TPAV + SLV'])
    assert.equal(parseItem(s).baseItem, 'TPAV+SLV', s)
  assert.deepEqual(parseItem('TPV+SLV'), ref)
  assert.deepEqual(parseItem('TPAV + SLV'), ref)
  assert.equal(parseItem('TPV').baseItem, 'TPAV')
})

test('a stored TPV item type gets the TPAV VA% cap and default', () => {
  assert.deepEqual(validateVaPercent('TPV', '80', 40), validateVaPercent('TPAV', '80', 40))
  assert.equal(getDefaultVaPercent('tpv', null), getDefaultVaPercent('TPAV', null))
})
