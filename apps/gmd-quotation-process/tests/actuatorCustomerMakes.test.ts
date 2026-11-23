// "Only AUMA is acceptable to Kalpataru" (Puja, 17 Nov): the makes a customer accepts limit the automatic pick.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUSTOMER_MAKES, customerOnly, HAND_ACT, HAND_MAKE, RM_NEW, selectActuator, type Master, type SelectInput } from '../lib/actuatorSelect.js'
import { planActuator } from '../lib/actuatorCost.js'
import { MASTER } from './actuatorFixture.js'

const NONE = new Map<string, number>()
const sel = (i: Partial<SelectInput>, m: Master = MASTER) => selectActuator({ mapKey: null, actuatorItem: false, qty: 2, text: '', ...i }, m, NONE, NONE)
const flagsOf = (s: { flags: string[] }) => s.flags.filter((f) => !f.startsWith(RM_NEW))
const act = (s: { act: { make: string; model: string | null; rpm: number | null } | null }) => `${s.act?.make} ${s.act?.model} @${s.act?.rpm}`
const KPIL = 'KALPATARU PROJECTS INTERNATIONAL LIMITED'
const AUMA_ONLY = 'customer accepts AUMA only'

test('customer list: one constant, party-name pattern -> accepted makes', () => {
  assert.deepEqual(CUSTOMER_MAKES.map((c) => [c.party.test('M/s Kalpataru Projects'), c.makes]), [[true, ['AUMA']]])
  assert.equal(customerOnly(['AUMA']), AUMA_ONLY)
})

test('Kalpataru: AUMA only, even when the text names Rotork or both; another party unchanged', () => {
  // SLUICE|300|PN10: Rotork K600 @24 is the cheaper pick for anyone else
  for (const text of ['', 'ACTUATOR MAKE: ROTORK', 'WITH ACTUATOR ( ACTUATOR MAKE - ROTORK/AUMA)', 'ACTUATOR MAKE : AUMA']) {
    const { selection: s, missing } = sel({ mapKey: 'SLUICE|300|PN10', text, party: KPIL })
    assert.deepEqual([act(s), s.aumaRequired, s.status, missing, flagsOf(s)], ['AUMA SA 50 @32', true, 'OK', [], []], text)
  }
  assert.equal(sel({ mapKey: 'BFV|100|PN10', party: 'kalpataru power' }).selection.act!.make, 'AUMA') // any letter case
  for (const party of [undefined, null, '', 'LARSEN & TOUBRO LIMITED']) {
    assert.equal(act(sel({ mapKey: 'SLUICE|300|PN10', party }).selection), 'Rotork K600 @24')
    assert.equal(act(sel({ mapKey: 'SLUICE|300|PN10', text: 'ROTORK', party }).selection), 'Rotork K600 @24')
    const both = sel({ mapKey: 'SLUICE|300|PN10', text: 'ACTUATOR MAKE - ROTORK/AUMA', party }).selection
    assert.deepEqual([both.act!.make, both.aumaRequired, flagsOf(both)], ['Rotork', false, []])
  }
})

test('Kalpataru: a make / actuator typed by hand still wins, flagged "customer accepts AUMA only" when it is not AUMA', () => {
  const rotork = sel({ mapKey: 'BFV|500|PN16', make: 'Rotork', party: KPIL }).selection
  assert.deepEqual([act(rotork), flagsOf(rotork)], ['Rotork K150 @36', [HAND_MAKE, AUMA_ONLY]])
  const typed = sel({ mapKey: 'BFV|500|PN16', actCode: 'ACT-RT-K150', party: KPIL }).selection
  assert.equal(typed.act!.make, 'Rotork')
  assert.ok(typed.flags.includes(HAND_ACT) && typed.flags.includes(AUMA_ONLY))
  const auma = sel({ mapKey: 'BFV|500|PN16', make: 'AUMA', party: KPIL }).selection
  assert.deepEqual([auma.act!.make, flagsOf(auma)], ['AUMA', [HAND_MAKE]])
  // the same hand make for another party: no customer flag
  assert.deepEqual(flagsOf(sel({ mapKey: 'BFV|500|PN16', make: 'Rotork', party: 'L&T' }).selection), [HAND_MAKE])
})

test('Kalpataru: a typed code nobody knows is not labelled AUMA by the customer list (review I2)', () => {
  const unknown = (i: Partial<SelectInput>) => sel({ mapKey: 'BFV|500|PN16', actCode: 'RCB049999', ...i }).selection
  const k = unknown({ party: KPIL })
  assert.equal(k.act!.make, 'Rotork')
  assert.ok(k.flags.includes(HAND_ACT) && k.flags.includes(AUMA_ONLY))
  const named = unknown({ party: KPIL, text: 'ACTUATOR MAKE : AUMA' })
  assert.equal(named.act!.make, 'AUMA')
  assert.ok(!named.flags.includes(AUMA_ONLY))
  const other = unknown({ party: 'L&T' })
  assert.equal(other.act!.make, 'Rotork')
  assert.ok(!other.flags.includes(AUMA_ONLY))
})

test('Kalpataru: no AUMA option gives the torque -> price pending with a plain reason, never silently Rotork', () => {
  const noAuma: Master = { ...MASTER, aumaSpeeds: [] } // AUMA has no speed that gives the torque; Rotork K600 would
  assert.equal(sel({ mapKey: 'SLUICE|300|PN10' }, noAuma).selection.act!.make, 'Rotork')
  const { selection: s, missing } = sel({ mapKey: 'SLUICE|300|PN10', text: 'ROTORK', party: KPIL }, noAuma)
  assert.deepEqual([s.act, s.status, missing], [null, 'PENDING', ['no AUMA actuator for 325 Nm (customer accepts AUMA only)']])
  const p = planActuator({ itemType: 'SLUICE VALVE-METAL SEATED', productCost: 100000, bareValveCost: null, lastTotal: null }, { selection: s, missing })
  assert.deepEqual([p.cost.total, p.cost.pending], [null, missing])
  // with a gearbox (BFV): the same reason
  assert.match(sel({ mapKey: 'BFV|500|PN16', party: KPIL }, noAuma).missing[0], /^no AUMA actuator for \d+ Nm \(customer accepts AUMA only\)$/)
})
