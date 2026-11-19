import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptorEstimate, assemblyEstimate, handPicks, HAND_ACT, HAND_GB, RATE_FLAG, selectActuator, type SelectInput } from '../lib/actuatorSelect.js'
import { planActuator, SPECIAL_OEM } from '../lib/actuatorCost.js'
import { FREE, MASTER } from './actuatorFixture.js'

const sel = (i: Partial<SelectInput>, free = FREE, rm = new Map<string, number>()) =>
  selectActuator({ mapKey: null, op: 'ACT+GB', actuatorItem: false, qty: 2, text: '', ...i }, MASTER, free, rm)
const valve = (productCost: number | null) => ({ itemType: 'BUTTERFLY VALVE', productCost, bareValveCost: null, lastTotal: null })

test('BFV|500|PN16 ACT+GB qty 2: stock gearbox RL1010012, stock K150, adaptor F25 6,000, assembly DN500 3,000', () => {
  const { selection: s, missing } = sel({ mapKey: 'BFV|500|PN16' })
  assert.deepEqual(missing, [])
  assert.deepEqual([s.status, s.valveType, s.dn, s.pn, s.qty, s.requiredTorque, s.actNeed, s.topFlange], ['OK', 'BFV', 500, 'PN16', 2, 6198, 155, 'F25'])
  assert.deepEqual(s.gb, { source: 'stock', model: 'VWESGA-80', erpCode: 'RL1010012', gbCode: 'GB-VI-VWESGA80', torque: 8000, rate: 17625, rateSource: 'SHEET', rateFlag: null })
  // two free K150 lines tie on 228 Nm: the one with more free stock; no RM rate, so the ACT_MASTER price of K150
  assert.deepEqual(s.act, { source: 'stock', make: 'Rotork', model: 'K150', erpCode: 'RCB040002', actCode: 'ACT-RT-K150', torque: 228, rate: 57912, rateSource: 'SHEET', rateFlag: null })
  assert.deepEqual([s.adaptor, s.assembly], [{ amount: 6000, estimated: true }, { amount: 3000, estimated: true }])
  // no free K150 line: stock still comes first (a free K300 line), and with no free Rotork line a new K150 at the sheet price
  const noK150 = new Map([...FREE].filter(([c]) => c !== 'RCD020026' && c !== 'RCB040002'))
  assert.deepEqual([sel({ mapKey: 'BFV|500|PN16' }, noK150).selection.act!.source, sel({ mapKey: 'BFV|500|PN16' }, noK150).selection.act!.model], ['stock', 'K300'])
  const noActStock = new Map([...FREE].filter(([c]) => !c.startsWith('RC')))
  const n = sel({ mapKey: 'BFV|500|PN16' }, noActStock).selection.act!
  assert.deepEqual([n.source, n.model, n.erpCode, n.actCode, n.rate, n.rateSource], ['rotork', 'K150', null, 'ACT-RT-K150', 57912, 'SHEET'])
})

test('BFV|700|PN16 ACT+GB qty 2: gearbox RL2010003 (15,000 Nm, VWESGA-150), actuator need 238 -> K300 from stock', () => {
  const s = sel({ mapKey: 'BFV|700|PN16' }).selection
  assert.deepEqual([s.gb!.source, s.gb!.erpCode, s.gb!.model, s.gb!.torque], ['stock', 'RL2010003', 'VWESGA-150', 15000])
  assert.deepEqual([s.actNeed, s.act!.source, s.act!.model, s.act!.erpCode], [238, 'stock', 'K300', 'RCD020024'])
  assert.deepEqual([s.adaptor!.amount, s.assembly!.amount, s.status], [6000, 5000, 'OK'])
})

test('BFV|1300|PN16 qty 1: OEM RFQ, no cost, no codes', () => {
  const pick = sel({ mapKey: 'BFV|1300|PN16', qty: 1 })
  const s = pick.selection
  assert.deepEqual([s.status, s.mapKey, s.valveType, s.dn, s.pn, s.qty, s.requiredTorque, s.topFlange, s.act, s.gb, s.aumaRequired],
    ['OEM RFQ', 'BFV|1300|PN16', 'BFV', 1300, 'PN16', 1, 85030, 'F35', null, null, false])
  const p = planActuator({ itemType: 'ACTUATOR', productCost: null, bareValveCost: null, lastTotal: null }, pick, { actCode: 'RCB040006' })
  assert.equal(p.cost.total, null)
  assert.deepEqual(p.cost.pending, [SPECIAL_OEM])
  assert.deepEqual([p.actCode, p.gbCode, p.make], [null, null, 'Rotork'])
})

test('rate flag: a sheet price above the RM rate keeps the RM rate and asks to negotiate', () => {
  const s = sel({ mapKey: 'BFV|500|PN16' }, FREE, new Map([['RCB040002', 51705], ['RL1010012', 17630]])).selection
  assert.deepEqual([s.act!.rate, s.act!.rateSource, s.act!.rateFlag], [51705, 'RM', RATE_FLAG])
  assert.deepEqual([s.gb!.rate, s.gb!.rateSource, s.gb!.rateFlag], [17630, 'RM', null]) // Viral 17,625 is not above it
  assert.deepEqual(s.flags, [`Actuator K150: ${RATE_FLAG}`])
})

test('AUMA only when the item text asks for it and does not allow Rotork; SA rows only; blank-torque stock never proposed', () => {
  const auma = sel({ mapKey: 'BFV|500|PN16', text: 'ELECTRICAL OPERTATED BUTTERFLY VALVE WITH ACTUTATOR, ACTUTATOR MAKE : AUMA , WITH SCADA' }).selection
  assert.equal(auma.aumaRequired, true)
  // AUMA stock line RCB020011 has 6 free but no nameplate torque: skipped, so a new SA 14.2
  assert.deepEqual([auma.act!.source, auma.act!.make, auma.act!.model, auma.act!.rate], ['auma', 'AUMA', 'SA 14.2', 67000])
  // need 134: SQ 05.2 (150 Nm) would be smaller but is not an SA row
  assert.equal(sel({ mapKey: 'BFV|400|PN10', text: 'make AUMA' }).selection.act!.model, 'SA 14.2')
  const both = sel({ mapKey: 'BFV|500|PN16', text: 'WITH ACTUATOR & 3 PHASE STARTER ( ACTUATOR MAKE - ROTORK/AUMA)' }).selection
  assert.deepEqual([both.aumaRequired, both.act!.make], [false, 'Rotork'])
  // Rotork: K-series only (IQ20, 203 Nm, would be smaller than K150)
  const newRotork = sel({ mapKey: 'BFV|500|PN16' }, new Map()).selection.act!
  assert.deepEqual([newRotork.model, newRotork.source], ['K150', 'rotork'])
  assert.equal(sel({ mapKey: 'BFV|500|PN16', make: 'AUMA' }).selection.act!.make, 'AUMA') // make set by hand
})

test('free qty after allocations below the docket qty: new Viral gearbox and new Rotork actuator', () => {
  // live 32 / 70 / 29 minus Stock Allocation bookings leaves 1 free each; docket qty 2
  const s = sel({ mapKey: 'BFV|500|PN16' }, new Map([['RL1010012', 1], ['RCB040002', 1], ['RCD020026', 1]])).selection
  assert.deepEqual([s.gb!.source, s.gb!.model, s.gb!.erpCode, s.gb!.gbCode, s.gb!.rate], ['viral', 'VWESGA-80', 'RL1010012', 'GB-VI-VWESGA80', 17625])
  assert.deepEqual([s.act!.source, s.act!.model, s.act!.erpCode], ['rotork', 'K150', null])
})

test('gearbox only with ACT+GB, never AUMA GS; other valves take a non-worm multi-turn gearbox', () => {
  const direct = sel({ mapKey: 'BFV|500|PN16', op: 'ACT' })
  assert.equal(direct.selection.gb, null)
  assert.equal(direct.selection.actNeed, 6198) // no gearbox: the actuator takes the full required torque
  assert.deepEqual(direct.missing, ['no Rotork K-series actuator ≥ 6198 Nm'])
  assert.equal(direct.selection.status, 'PENDING')
  const sluice = sel({ mapKey: 'SLUICE|80|PN10' }).selection
  assert.deepEqual([sluice.gb!.source, sluice.gb!.model, sluice.gb!.erpCode], ['viral', 'SGB-600 / SGBE-600', 'RSE010030'])
  const spurInStock = sel({ mapKey: 'SLUICE|80|PN10' }, new Map([...FREE, ['RSE010030', 15]])).selection.gb!
  assert.deepEqual([spurInStock.source, spurInStock.model, spurInStock.torque], ['stock', 'SGB-600 / SGBE-600', 500])
})

test('blank price is pending, never 0; no MAPPING row is pending', () => {
  const pick = sel({ mapKey: 'SLUICE|700|PN10', op: 'ACT', text: 'AUMA' })
  assert.deepEqual([pick.selection.act!.model, pick.selection.act!.rate, pick.selection.status], ['SA 25.1', null, 'PENDING'])
  assert.deepEqual(pick.missing, ['actuator price (SA 25.1)'])
  const p = planActuator(valve(100000), pick)
  assert.equal(p.cost.total, null)
  assert.match(p.cost.text, /^Price pending: actuator price \(SA 25\.1\)/)
  assert.deepEqual(sel({ mapKey: 'BFV|2500|PN16' }).missing, ['no MAPPING row for BFV|2500|PN16'])
  assert.deepEqual(sel({ mapKey: null }).missing, ['MAP KEY not derivable (needs a valve type, size and PN)'])
})

test('adaptor by valve top flange, assembly by DN', () => {
  assert.deepEqual(['F07/F10', 'F12', 'F14', 'F16', 'F25', 'F30', 'F35', 'F48', 'F60', '—', null].map(adaptorEstimate),
    [1500, 2500, 2500, 3500, 6000, 10000, 10000, 10000, 10000, null, null])
  assert.deepEqual([80, 300, 350, 600, 700, 1000, 1100, 1900, null].map(assemblyEstimate), [1500, 1500, 3000, 3000, 5000, 5000, 8000, 8000, null])
})

test('cost = valve + actuator + gearbox + adaptor + assembly, each part shown; a typed amount wins; ACTUATOR item = actuator + gearbox', () => {
  const p = planActuator(valve(100000), sel({ mapKey: 'BFV|500|PN16' }))
  assert.equal(p.cost.total, 100000 + 57912 + 17625 + 6000 + 3000)
  assert.equal(p.cost.text,
    'Valve 1,00,000 + ACT Rotork K150 (stock RCB040002) 57,912 + GB VWESGA-80 (stock RL1010012) 17,625 + Adaptor/coupling (est.) 6,000 + Assembly & testing (est.) 3,000 = 1,84,537')
  assert.deepEqual([p.make, p.actCode, p.gbCode, p.bare], ['Rotork', 'ACT-RT-K150', 'GB-VI-VWESGA80', 100000])
  const typed = sel({ mapKey: 'BFV|500|PN16', adaptor: 0, assembly: 2500 }).selection
  assert.deepEqual([typed.adaptor, typed.assembly], [{ amount: 0, estimated: false }, { amount: 2500, estimated: false }])
  const actuatorOnly = sel({ mapKey: 'BFV|500|PN16', actuatorItem: true })
  assert.deepEqual([actuatorOnly.selection.adaptor, actuatorOnly.selection.assembly], [null, null])
  assert.equal(planActuator({ itemType: 'ACTUATOR', productCost: 999, bareValveCost: null, lastTotal: null }, actuatorOnly).cost.total, 57912 + 17625)
  assert.deepEqual(planActuator(valve(null), sel({ mapKey: 'BFV|500|PN16' })).cost.pending, ['bare valve cost'])
})

test('codes typed by hand: RM rate first, sheet price as fallback; kept until cleared, a make change or a new MAP KEY', () => {
  // a Raw Material ERP code that is in neither master: priced from the RM master only
  const rm = sel({ mapKey: 'BFV|500|PN16', actCode: 'RCB099999', gbCode: 'red070005' }, FREE, new Map([['RCB099999', 40000], ['RED070005', 5350]])).selection
  assert.deepEqual([rm.act!.source, rm.act!.erpCode, rm.act!.rate, rm.act!.rateSource], ['stock', 'RCB099999', 40000, 'RM'])
  assert.deepEqual([rm.gb!.model, rm.gb!.erpCode, rm.gb!.rate, rm.gb!.rateSource, rm.gb!.rateFlag], ['VWE-10', 'RED070005', 5350, 'RM', null])
  assert.deepEqual(rm.flags, [HAND_GB, HAND_ACT])
  // a K30 stock line typed as its ERP code: no RM rate, so the K30 sheet price
  const k30 = sel({ mapKey: 'BFV|500|PN16', actCode: 'RCB040006' }).selection.act!
  assert.deepEqual([k30.model, k30.erpCode, k30.rate, k30.rateSource], ['K30', 'RCB040006', 53664, 'SHEET'])
  // unknown, not an ERP code: price pending
  assert.deepEqual(sel({ mapKey: 'BFV|500|PN16', actCode: 'K150' }).missing, ['actuator price (K150)'])

  const pinned = { actuatorMake: 'Rotork', actCode: 'RCB099999', actuatorBreakdown: { selection: rm } }
  assert.deepEqual(handPicks({}, { actCode: 'RCB099999' }, MASTER), { make: null, actCode: 'RCB099999', gbCode: null })
  assert.equal(handPicks(pinned, {}, MASTER).actCode, 'RCB099999') // next run keeps it
  assert.equal(handPicks(pinned, { actCode: 'RCB099999', gbCode: null }, MASTER).actCode, 'RCB099999') // dialog re-sends it unchanged
  assert.equal(handPicks(pinned, { actCode: null }, MASTER).actCode, null) // cleared
  assert.equal(handPicks(pinned, { actuatorMake: 'AUMA' }, MASTER).actCode, null) // make change re-picks
  // a typed master code survives the next run too (the pick marks it)
  const k300 = sel({ mapKey: 'BFV|500|PN16', actCode: 'ACT-RT-K300' }).selection
  assert.equal(handPicks({ actCode: 'ACT-RT-K300', actuatorBreakdown: { selection: k300 } }, {}, MASTER).actCode, 'ACT-RT-K300')
  // what an auto pick wrote is picked again
  const auto = sel({ mapKey: 'BFV|500|PN16' }).selection
  assert.deepEqual(handPicks({ actuatorMake: 'Rotork', actCode: 'ACT-RT-K150', gbCode: 'GB-VI-VWESGA80', actuatorBreakdown: { selection: auto } }, {}, MASTER),
    { make: null, actCode: null, gbCode: null })
  assert.equal(handPicks({ actuatorMake: 'AUMA', actuatorBreakdown: { selection: auto } }, {}, MASTER).make, 'AUMA') // make set by hand stays
  // linked before the live sheet: MAPPING codes and the AUMA default were auto-filled; a typed ERP code was not
  assert.deepEqual(handPicks({ actuatorMake: 'AUMA', actCode: 'ACT-AU-SA14.2', gbCode: 'GB-AU-125.3' }, {}, MASTER), { make: null, actCode: null, gbCode: null })
  assert.equal(handPicks({ gbCode: 'RED070005' }, {}, MASTER).gbCode, 'RED070005')
})
