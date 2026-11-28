// Functionalities printed under the actuator line of an actuated item in the offer (Puja, 17 Nov).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ACT_FUNCTIONS as F, offerActuatorLine } from '../lib/offerActuatorLine.js'

const VALVE = { operationType: 'ACT+GB', itemType: 'BUTTERFLY VALVE' }
const withSelection = (selection: unknown) => ({ ...VALVE, actuatorBreakdown: { selection } })
const SEL = { status: 'OK', topFlange: 'F16', act: { source: 'auma', make: 'AUMA', model: 'SA 25' }, gb: null }
const lines = (it: Parameters<typeof offerActuatorLine>[0]) => offerActuatorLine(it)?.split('\n')

test('functionalities: exact wording, in one constant', () => {
  assert.deepEqual(F, {
    partTurn: 'Type: Integral, electric part-turn', multiTurn: 'Type: Integral, electric multi-turn',
    power3: 'Power supply: 415 V, 3 phase, 50 Hz', power1: 'Power supply: 230 V, 1 phase, 50 Hz',
    limit: 'Limit switches: 2 nos (2NO + 2NC)', torque: 'Torque switches: 2 nos (2NO + 2NC)',
    mode: 'Operating mode: Local & Remote', pt: 'Position transmitter: 4–20 mA',
  })
})

test('butterfly valve: part-turn; every other valve type: multi-turn; after the actuator line', () => {
  assert.deepEqual(lines({ ...withSelection(SEL), itemName: 'BFV DN500 PN16 ELECTRIC ACTUATED' }),
    ['Actuator: AUMA SA 25 | Top flange: F16', F.partTurn, F.power3, F.limit, F.torque, F.mode])
  assert.deepEqual(lines({ ...withSelection(SEL), itemType: 'SLUICE VALVE-METAL SEATED', itemName: 'SLUICE VALVE DN350' }),
    ['Actuator: AUMA SA 25 | Top flange: F16', F.multiTurn, F.power3, F.limit, F.torque, F.mode])
  assert.equal(lines({ ...withSelection(SEL), itemType: 'KNIFE GATE VALVE' })![1], F.multiTurn)
})

test('item type ACTUATOR: the valve type is read from the item name', () => {
  const act = { operationType: null, itemType: 'ACTUATOR', actuatorBreakdown: { selection: SEL } }
  assert.equal(lines({ ...act, itemName: 'ACTUATOR FOR BUTTERFLY VALVE DN600' })![1], F.partTurn)
  assert.equal(lines({ ...act, itemName: 'ACTUATOR FOR SLUICE VALVE DN600' })![1], F.multiTurn)
})

test('single phase in the item text: 230 V, 1 phase', () => {
  assert.equal(lines({ ...withSelection(SEL), itemName: 'BFV WITH ACTUATOR 230V SINGLE PHASE' })![2], F.power1)
  assert.equal(lines({ ...withSelection(SEL), itemName: 'BFV, 3 phase, single phase control' })![2], F.power3)
})

test('position transmitter: only with "With PT" / "position transmitter" in the item text', () => {
  const sluice = { ...withSelection(SEL), itemType: 'SLUICE VALVE-METAL SEATED' }
  assert.equal(lines({ ...sluice, itemName: 'SLUICE VALVE DN350 ELECTRIC ACTUATED With PT' })!.at(-1), F.pt)
  assert.equal(lines({ ...sluice, itemName: 'sluice valve with pt' })!.at(-1), F.pt)
  assert.equal(lines({ ...sluice, itemName: 'SLUICE VALVE WITH POSITION TRANSMITTER' })!.at(-1), F.pt)
  assert.equal(lines({ ...sluice, itemName: 'SLUICE VALVE WITH PTFE SEAT, WITHOUT PT' })!.at(-1), F.mode)
  assert.equal(lines({ ...sluice, itemName: null })!.at(-1), F.mode)
})

test('refer-OEM item: "to be confirmed by OEM" and the functionalities; an actuated item with no pick still prints them', () => {
  assert.deepEqual(lines(withSelection({ status: 'OEM RFQ', topFlange: 'F35', act: null, gb: null })),
    ['Actuator: to be confirmed by OEM | Top flange: F35', F.partTurn, F.power3, F.limit, F.torque, F.mode])
  assert.deepEqual(lines({ ...VALVE, actuatorMake: 'AUMA', actuatorBreakdown: { pending: ['Special – refer OEM'] } }),
    [F.partTurn, F.power3, F.limit, F.torque, F.mode])
})

test('non-actuated items print nothing; no price anywhere', () => {
  assert.equal(offerActuatorLine({ operationType: 'STANDARD', itemType: 'BUTTERFLY VALVE', itemName: 'BFV WITH PT', actuatorMake: 'Rotork', actCode: 'ACT-RT-K150' }), null)
  assert.equal(offerActuatorLine({ ...VALVE, actuatorMake: 'AUMA', itemName: 'BFV WITH PT' }), null) // ACT row never linked to the master
  const priced = { ...SEL, act: { ...SEL.act, rate: 67000 }, adaptor: { amount: 3500 }, assembly: { amount: 3000 } }
  assert.doesNotMatch(offerActuatorLine({ ...VALVE, actuatorBreakdown: { total: 180000, selection: priced } })!, /67|3500|3000|180000|₹|Rs/)
})
