import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toNumber,
  computeDeliverySchedule,
  DEFAULT_DELIVERY_SCHEDULE,
} from '../lib/deliverySchedule.js'

test('toNumber parses numbers with commas, spaces and decimals', () => {
  assert.equal(toNumber('1,000'), 1000)
  assert.equal(toNumber('  42  '), 42)
  assert.equal(toNumber('254.5'), 254.5)
  assert.equal(toNumber(42), 42)
  assert.equal(toNumber(null), null)
  assert.equal(toNumber(undefined), null)
  assert.equal(toNumber(''), null)
  assert.equal(toNumber('abc'), null)
})

test('delivery schedule is 2-3 weeks when available stock >= quantity', () => {
  assert.equal(computeDeliverySchedule(2, '42'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(2, '2'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(0, '0'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule('100', '1,000'), DEFAULT_DELIVERY_SCHEDULE)
})

test('delivery schedule stays null when available stock < quantity', () => {
  assert.equal(computeDeliverySchedule(6, '0'), null)
  assert.equal(computeDeliverySchedule(340, '42'), null)
  assert.equal(computeDeliverySchedule(23, '5'), null)
})

test('delivery schedule stays null when either value is missing', () => {
  assert.equal(computeDeliverySchedule(10, null), null)
  assert.equal(computeDeliverySchedule(null, '10'), null)
  assert.equal(computeDeliverySchedule(undefined, undefined), null)
  assert.equal(computeDeliverySchedule(10, ''), null)
  assert.equal(computeDeliverySchedule('', '10'), null)
})

test('delivery schedule stays null when available stock is not numeric', () => {
  assert.equal(computeDeliverySchedule(10, 'abc'), null)
  assert.equal(computeDeliverySchedule(10, 'N/A'), null)
})