import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItem, BASE_ITEMS, SLV_TYPES } from '../lib/itemVersionResolver.js'

test('BASE_ITEMS contains only the allowed item set', () => {
  assert.deepEqual(
    [...BASE_ITEMS].sort(),
    [
      'BFV',
      'CF',
      'DPCV',
      'DV',
      'GV',
      'NRV',
      'PRV',
      'SLV',
      'SLV METAL',
      'TPAV',
      'TPAV+SLV',
    ].sort(),
  )
})

test('SLV_TYPES covers the SLV-family base items', () => {
  assert.equal(SLV_TYPES.has('SLV'), true)
  assert.equal(SLV_TYPES.has('TPAV+SLV'), true)
  assert.equal(SLV_TYPES.has('SLV METAL'), true)
  assert.equal(SLV_TYPES.has('BFV'), false)
})

test('DI maps to v1', () => {
  assert.deepEqual(parseItem('BFV DI'), {
    baseItem: 'BFV',
    hasVersionExtras: true,
    v1: 'DI',
    v2: '',
    v3: '',
    v4: '',
  })
})

test('CS maps to v2', () => {
  assert.deepEqual(parseItem('BFV CS'), {
    baseItem: 'BFV',
    hasVersionExtras: true,
    v1: '',
    v2: 'CS',
    v3: '',
    v4: '',
  })
})

test('9523 on SLV-type item maps to v2', () => {
  assert.deepEqual(parseItem('SLV 9523'), {
    baseItem: 'SLV',
    hasVersionExtras: true,
    v1: '',
    v2: '9523',
    v3: '',
    v4: '',
  })
})

test('9523 on TPAV+SLV maps to v2', () => {
  const result = parseItem('TPAV+SLV 9523')
  assert.equal(result.baseItem, 'TPAV+SLV')
  assert.equal(result.v2, '9523')
  assert.equal(result.v4, '')
})

test('9523 on SLV METAL maps to v2', () => {
  const result = parseItem('SLV METAL 9523')
  assert.equal(result.baseItem, 'SLV METAL')
  assert.equal(result.v2, '9523')
  assert.equal(result.v4, '')
})

test('9523 on non-SLV item maps to v4', () => {
  assert.deepEqual(parseItem('BFV 9523'), {
    baseItem: 'BFV',
    hasVersionExtras: true,
    v1: '',
    v2: '',
    v3: '',
    v4: '9523',
  })
})

test('RISING maps to v3', () => {
  assert.deepEqual(parseItem('SLV RISING'), {
    baseItem: 'SLV',
    hasVersionExtras: true,
    v1: '',
    v2: '',
    v3: 'RISING',
    v4: '',
  })
})

test('WAFER maps to v3', () => {
  const result = parseItem('BFV WAFER')
  assert.equal(result.baseItem, 'BFV')
  assert.equal(result.v3, 'WAFER')
  assert.equal(result.v1, '')
  assert.equal(result.v2, '')
  assert.equal(result.v4, '')
})

test('RISING + 9523 maps to v4 (precedence over v2/v3)', () => {
  assert.deepEqual(parseItem('SLV RISING 9523'), {
    baseItem: 'SLV',
    hasVersionExtras: true,
    v1: '',
    v2: '',
    v3: '',
    v4: 'RISING 9523',
  })
})

test('RISING + 9523 maps to v4 even on non-SLV items', () => {
  const result = parseItem('BFV RISING 9523')
  assert.equal(result.baseItem, 'BFV')
  assert.equal(result.v4, 'RISING 9523')
  assert.equal(result.v2, '')
  assert.equal(result.v3, '')
})

test('bare base item yields no version extras', () => {
  assert.deepEqual(parseItem('SLV'), {
    baseItem: 'SLV',
    hasVersionExtras: false,
    v1: '',
    v2: '',
    v3: '',
    v4: '',
  })
})

test('is case-insensitive and collapses whitespace', () => {
  const result = parseItem('  slv    rising   9523  ')
  assert.equal(result.baseItem, 'SLV')
  assert.equal(result.v4, 'RISING 9523')
})

test('longest base item wins (SLV METAL over SLV)', () => {
  assert.equal(parseItem('SLV METAL 9523').baseItem, 'SLV METAL')
})

test('TPAV+SLV matches before TPAV or SLV alone', () => {
  assert.equal(parseItem('TPAV+SLV 9523').baseItem, 'TPAV+SLV')
})

test('DI and 9523 together: DI wins per precedence', () => {
  const result = parseItem('BFV DI 9523')
  assert.equal(result.baseItem, 'BFV')
  assert.equal(result.v1, 'DI')
  assert.equal(result.v4, '')
})

test('returns empty result for null/undefined/empty', () => {
  const empty = {
    baseItem: null,
    hasVersionExtras: false,
    v1: '',
    v2: '',
    v3: '',
    v4: '',
  }
  assert.deepEqual(parseItem(null), empty)
  assert.deepEqual(parseItem(undefined), empty)
  assert.deepEqual(parseItem(''), empty)
})

test('returns baseItem null for unknown item', () => {
  assert.deepEqual(parseItem('SOMETHING ELSE'), {
    baseItem: null,
    hasVersionExtras: false,
    v1: '',
    v2: '',
    v3: '',
    v4: '',
  })
})