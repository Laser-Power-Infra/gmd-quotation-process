import test from 'node:test'
import assert from 'node:assert/strict'
import { offerActuatorLine } from '../lib/offerActuatorLine.js'

const VALVE = { operationType: 'ACT+GB', itemType: 'BUTTERFLY VALVE' }
const withSelection = (selection: unknown) => ({ ...VALVE, actuatorBreakdown: { selection } })

test('selection: actuator make + model, gearbox and top flange as given in the master', () => {
  const selection = {
    status: 'OK', topFlange: 'F25',
    act: { source: 'stock', make: 'Rotork', model: 'K150', erpCode: 'E1', actCode: 'ACT-RT-K150' },
    gb: { source: 'viral', model: 'VWESGA-80', erpCode: null, gbCode: 'GB-VI-VWESGA80' },
  }
  assert.equal(offerActuatorLine(withSelection(selection)), 'Actuator: Rotork K150 | Gearbox: Viral VWESGA-80 | Top flange: F25')
  // Missing parts are dropped; the selection wins over the item's code columns.
  assert.equal(
    offerActuatorLine({ ...withSelection({ status: 'PENDING', act: { source: 'auma', make: 'AUMA', model: 'SA 14.2' }, gb: null }), actCode: 'ACT-RT-K30' }),
    'Actuator: AUMA SA 14.2',
  )
})

test('new selection: rpm, gearbox ratio and operating time; old ones without them still print', () => {
  const selection = {
    status: 'OK', topFlange: 'F16', time: 1.76,
    act: { source: 'auma', make: 'AUMA', model: 'SA 25', rpm: 125 }, gb: { source: 'viral', model: 'SGB-600', ratio: '4:1' },
  }
  assert.equal(offerActuatorLine(withSelection(selection)), 'Actuator: AUMA SA 25 @125 rpm | Gearbox: Viral SGB-600 (4:1) | Top flange: F16 | Operating time: 1.76 min')
  assert.equal(offerActuatorLine(withSelection({ ...selection, time: 2, act: { ...selection.act, rpm: null }, gb: { ...selection.gb, ratio: null } })),
    'Actuator: AUMA SA 25 | Gearbox: Viral SGB-600 | Top flange: F16 | Operating time: 2.00 min')
})

test('no selection yet: make + model from the codes, no flange', () => {
  const item = { ...VALVE, actuatorMake: 'Rotork', actCode: 'ACT-RT-K150', gbCode: 'GB-VI-VWESGA80', actuatorBreakdown: { total: 1, pending: [] } }
  assert.equal(offerActuatorLine(item), 'Actuator: Rotork K150 | Gearbox: VWESGA80')
  assert.equal(offerActuatorLine({ ...VALVE, actuatorMake: 'AUMA', actCode: 'ACT-AU-SA14.2' }), 'Actuator: AUMA SA14.2')
  // A make with no code is only the default, not a selected actuator.
  assert.equal(offerActuatorLine({ ...VALVE, actuatorMake: 'AUMA', actuatorBreakdown: { pending: ['Special – refer OEM'] } }), null)
})

test('OEM RFQ: actuator to be confirmed by OEM', () => {
  assert.equal(
    offerActuatorLine(withSelection({ status: 'OEM RFQ', topFlange: 'F35', act: null, gb: null })),
    'Actuator: to be confirmed by OEM | Top flange: F35',
  )
})

test('non-actuated items print nothing', () => {
  assert.equal(offerActuatorLine({ operationType: 'STANDARD', itemType: 'BUTTERFLY VALVE', actuatorMake: 'Rotork', actCode: 'ACT-RT-K150' }), null)
  assert.equal(offerActuatorLine({ ...VALVE, actuatorMake: 'AUMA' }), null) // ACT row never linked to the master
})
