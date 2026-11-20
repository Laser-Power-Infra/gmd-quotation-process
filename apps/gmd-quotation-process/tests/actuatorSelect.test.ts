import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACT_RULES, adaptorEstimate, assemblyEstimate, handPicks, HAND_ACT, HAND_GB, HAND_MAKE, RATE_FLAG, RM_NEW, selectActuator, SINGLE_PHASE,
  rmLookupCodes, specTime, TYPED_WEAK, type Master, type SelectInput,
} from '../lib/actuatorSelect.js'
import { planActuator, SPECIAL_OEM } from '../lib/actuatorCost.js'
import { FREE, MASTER } from './actuatorFixture.js'
import { SHEET_ROWS } from './actuatorSheetSelection.js'

const NONE = new Map<string, number>()
const sel = (i: Partial<SelectInput>, free = NONE, rm = new Map<string, number>(), m: Master = MASTER) =>
  selectActuator({ mapKey: null, actuatorItem: false, qty: 2, text: '', ...i }, m, free, rm)
// the flags apart from "RM code to be created" (most tests give no RM map, so every bought pick carries it)
const flagsOf = (s: { flags: string[] }) => s.flags.filter((f) => !f.startsWith(RM_NEW))
const valve = (productCost: number | null) => ({ itemType: 'BUTTERFLY VALVE', productCost, bareValveCost: null, lastTotal: null })
const act = (s: { act: { make: string; model: string | null; rpm: number | null } | null }) => `${s.act?.make} ${s.act?.model} @${s.act?.rpm}`
const price = (m: Master, prices: Record<string, number | null>): Master => ({ ...m, actuators: m.actuators.map((a) => (String(a.actCode) in prices ? { ...a, price: prices[String(a.actCode)] } : a)) })

test("the sheet's worked example: sluice DN350 PN16, 569 Nm -> SGB-600, 163 Nm in, 220 turns, AUMA SA 25 @125 rpm, 73,500, 1.76 min", () => {
  const { selection: s, missing } = sel({ mapKey: 'SLUICE|350|PN16' })
  assert.deepEqual(missing, [])
  assert.deepEqual([s.gb!.model, s.gb!.ratio, s.gb!.source, s.actNeed], ['SGB-600', '4:1', 'viral', 163])
  assert.deepEqual(s.act, { source: 'auma', make: 'AUMA', model: 'SA 25', erpCode: null, actCode: 'ACT-AU-SA25', torque: 220, rpm: 125, rmCode: 'RCC010021', rate: 67000, rateSource: 'SHEET', rateFlag: null })
  assert.equal(s.act!.rate! + s.gb!.rate!, 73500)
  assert.deepEqual([s.time, s.timeLimit, Math.round(s.time! * s.act!.rpm!), flagsOf(s)], [1.76, 2, 220, []]) // 55 turns x 4 = 220 actuator turns, need >= 110 rpm
  // the Rotork alternative the sheet compares: K300 @144 rpm (271 Nm), 74,461
  const r = sel({ mapKey: 'SLUICE|350|PN16', text: 'ACTUATOR MAKE: ROTORK' }).selection
  assert.deepEqual([act(r), r.act!.torque, r.act!.rate, r.time], ['Rotork K300 @144', 271, 74461, 1.53])
  // cost build-up: valve + actuator + gearbox + adaptor F16 + assembly DN350
  const p = planActuator(valve(100000), { selection: s, missing })
  assert.equal(p.cost.total, 100000 + 73500 + 3500 + 3000)
  assert.equal(p.cost.text,
    'Valve 1,00,000 + ACT AUMA SA 25 @125 rpm 67,000 + GB Viral SGB-600 (4:1) 6,500 + Adaptor/coupling (est.) 3,500 + Assembly & testing (est.) 3,000 = 1,80,000 · operating time 1.76 min [RM code to be created: AUMA SA 25; RM code to be created: Viral SGB-600]')
  assert.deepEqual([p.make, p.actCode, p.gbCode], ['AUMA', 'ACT-AU-SA25', 'GB-VI-SGB600'])
})

test('BFV: always a Viral worm gearbox, actuator turns = ratio ÷ 4', () => {
  const s = sel({ mapKey: 'BFV|500|PN16' }).selection
  assert.deepEqual([s.gb!.model, s.gb!.ratio, s.gb!.erpCode, s.actNeed, act(s), s.time], ['VWESGA-80', '220:1', 'RL1010012', 89, 'AUMA SA 12 @32', 1.72]) // 55 turns
  const small = sel({ mapKey: 'BFV|100|PN10' }).selection // 60 Nm: VWE-07 (40:1 -> 10 turns), Rotork K30 @6 is cheapest
  assert.deepEqual([small.gb!.model, act(small), small.time, small.act!.rate! + small.gb!.rate!], ['VWE-07', 'Rotork K30 @6', 1.67, 57864])
})

test('sluice up to DN300: direct actuator, no gearbox; Rotork when cheaper', () => {
  const s = sel({ mapKey: 'SLUICE|300|PN10' }).selection // 47 turns, >= 23.5 rpm: K600 @24 89,849 vs SA 50 @32 94,400
  assert.deepEqual([s.gb, s.actNeed, act(s), s.time, s.act!.rate], [null, 325, 'Rotork K600 @24', 1.96, 89849])
  assert.deepEqual(sel({ mapKey: 'KGV|50|PN10' }).selection.time, 2) // 8 turns at 4 rpm: exactly the limit counts as in time
})

test('torque drops with speed: the model that is big enough slow but not at the needed speed loses to the next size', () => {
  // BFV DN800: 110.7 Nm in at >= 75.6 rpm. SA 12 gives 120 Nm up to 63 rpm but 110 at 90: SA 15 @90.
  assert.equal(act(sel({ mapKey: 'BFV|800|PN10' }).selection), 'AUMA SA 15 @90')
  // Sluice DN150 PN16 (130 Nm, >= 12 rpm): K150 has 152 Nm but 115 at 12 rpm, so K150 @18
  assert.equal(act(sel({ mapKey: 'SLUICE|150|PN16', text: 'Rotork' }).selection), 'Rotork K150 @18')
  // BFV DN900: K150 at 144 rpm is 108 Nm (rated 152)
  const s = sel({ mapKey: 'BFV|900|PN10', text: 'rotork' }).selection
  assert.deepEqual([act(s), s.act!.torque], ['Rotork K150 @144', 108])
})

test('nothing turns the valve in time: the fastest combination, flagged "Over 2 min"', () => {
  const s = sel({ mapKey: 'SLUICE|500|PN10' }).selection // SGB-1000 needs >= 197.5 rpm
  assert.deepEqual([s.gb!.model, act(s), s.time, s.status], ['SGB-1000', 'Rotork K600 @192', 2.06, 'OK'])
  assert.deepEqual(flagsOf(s), ['Over 2 min'])
  // AUMA is the faster one here: K600 has only 434 Nm at 192 rpm (443 needed), 610 at 144
  const big = sel({ mapKey: 'SLUICE|1200|PN10' }).selection
  assert.deepEqual([big.gb!.model, big.gb!.ratio, act(big), big.time], ['SGB-10000', '16:1', 'AUMA SA 50 @180', 16.8])
})

test('make: Rotork on a tie, AUMA when cheaper, the make the BOQ names, a make set by hand', () => {
  assert.equal(sel({ mapKey: 'BFV|500|PN16' }).selection.act!.make, 'AUMA') // SA 12 56,500 < K150 57,912
  const tie = sel({ mapKey: 'BFV|500|PN16' }, NONE, new Map(), price(MASTER, { 'ACT-RT-K150': 56500 })).selection
  assert.equal(act(tie), 'Rotork K150 @36')
  const auma = sel({ mapKey: 'SLUICE|300|PN10', text: 'ELECTRICAL OPERTATED SLUICE VALVE, ACTUTATOR MAKE : AUMA , WITH SCADA' }).selection
  assert.deepEqual([auma.aumaRequired, act(auma), auma.act!.rate], [true, 'AUMA SA 50 @32', 94400])
  const both = sel({ mapKey: 'SLUICE|300|PN10', text: 'WITH ACTUATOR & 3 PHASE STARTER ( ACTUATOR MAKE - ROTORK/AUMA)' }).selection
  assert.deepEqual([both.aumaRequired, both.act!.make], [false, 'Rotork']) // both allowed: the cheaper
  const hand = sel({ mapKey: 'BFV|500|PN16', make: 'Rotork' }).selection
  assert.deepEqual([act(hand), flagsOf(hand)], ['Rotork K150 @36', [HAND_MAKE]])
  // only K-series and AUMA SA with a speed table are proposed (not IQ35, SQ, spare rows)
  assert.equal(sel({ mapKey: 'SLUICE|1200|PN10', text: 'Rotork' }).selection.act!.model, 'K600')
})

test('stock first: a free gearbox wins over a cheaper new one; a stock actuator only when marked auto-pick ON, free and fast enough', () => {
  const g = sel({ mapKey: 'BFV|100|PN10' }, FREE).selection // new VWE-07 is 600 cheaper, VWE-10 is in stock
  assert.deepEqual([g.gb!.model, g.gb!.source, g.gb!.erpCode, act(g)], ['VWE-10', 'stock', 'RED070005', 'Rotork K30 @6'])
  // BFV DN500: 89 Nm in at >= 27.5 rpm. Every STOCK_ACT line is auto-pick OFF today: new SA 12, stock VWESGA-80
  const off = sel({ mapKey: 'BFV|500|PN16' }, FREE).selection
  assert.deepEqual([off.act!.source, act(off), off.gb!.source], ['auma', 'AUMA SA 12 @32', 'stock'])
  const on: Master = { ...MASTER, stockAutoPick: ['RCB040002', 'RCB040004', 'RCB040006'] }
  const s = sel({ mapKey: 'BFV|500|PN16' }, FREE, new Map(), on).selection // K150/RPM24 is too slow (2.29 min), K30 too weak
  assert.deepEqual([s.act!.source, s.act!.erpCode, act(s), s.act!.rate, s.time], ['stock', 'RCB040004', 'Rotork K150 @48', 57912, 1.15])
  const short = sel({ mapKey: 'BFV|500|PN16', qty: 70 }, FREE, new Map(), on).selection // 69 free < docket qty 70
  assert.equal(short.act!.source, 'auma')
  assert.equal(short.gb!.source, 'viral')
})

test('rates: RM rate by the generic code, negotiate when the sheet is higher; no code -> sheet price + "RM code to be created"', () => {
  const s = sel({ mapKey: 'BFV|500|PN16' }, NONE, new Map([['RCC010028', 52000], ['RL1010012', 17700]])).selection
  assert.deepEqual([s.act!.rmCode, s.act!.rate, s.act!.rateSource, s.act!.rateFlag], ['RCC010028', 52000, 'RM', RATE_FLAG])
  assert.deepEqual([s.gb!.rate, s.gb!.rateSource, s.gb!.rateFlag], [17700, 'RM', null]) // 17,625 is not above it
  assert.deepEqual(s.flags, [`Actuator SA 12: ${RATE_FLAG}`])
  // the RM rate changes the pick: K150 at a 50,000 RM rate beats SA 12
  assert.equal(sel({ mapKey: 'BFV|500|PN16' }, NONE, new Map([['RCC010058', 50000]])).selection.act!.model, 'K150')
  const a = sel({ mapKey: 'SLUICE|300|PN10', text: 'AUMA' }).selection // SA 50: "NEW code"
  assert.deepEqual([a.act!.rmCode, a.act!.rate, a.act!.rateSource, a.status], [null, 94400, 'SHEET', 'OK'])
  assert.deepEqual(a.flags, [`${RM_NEW}: AUMA SA 50`])
  assert.deepEqual(sel({ mapKey: 'BFV|100|PN10' }).selection.flags, [`${RM_NEW}: Rotork K30`, `${RM_NEW}: Viral VWE-07`]) // no ERP code yet; K30's code is not in the RM map
})

test('single phase in the BOQ text: nothing auto-picked, flagged; a typed actuator still prices', () => {
  const s = sel({ mapKey: 'SLUICE|80|PN10', text: 'ACTUATOR 230V SINGLE PHASE, AUMA' })
  assert.deepEqual([s.selection.act, s.selection.gb, s.selection.status, s.missing], [null, null, 'PENDING', [SINGLE_PHASE]])
  assert.equal(sel({ mapKey: 'SLUICE|80|PN10', text: '1-ph supply' }).selection.act, null)
  assert.equal(sel({ mapKey: 'SLUICE|80|PN10', text: '3 phase, single phase control' }).selection.act!.make, 'AUMA') // three phase named too
  const typed = sel({ mapKey: 'SLUICE|80|PN10', text: 'single phase', actCode: 'ACT-AU-SA6' })
  assert.deepEqual([typed.selection.act!.model, typed.selection.act!.rpm, typed.selection.time, typed.missing], ['SA 6', null, null, []])
})

test('operating time from the BOQ text replaces the 2 min default', () => {
  assert.deepEqual(['OPERATING TIME: 60 SEC', 'closing time 1.5 min', 'Operating time 90 to 120 s', 'stroke time 45 seconds', 'as per IS 9334', 'time 60 sec'].map(specTime),
    [1, 1.5, 2, 0.75, null, null])
  const s = sel({ mapKey: 'SLUICE|350|PN16', text: 'operating time 60 sec' }).selection // 1 min: >= 220 rpm from SGB-600, so all over the limit
  assert.deepEqual([s.timeLimit, flagsOf(s)], [1, ['Over 1 min']])
  assert.equal(ACT_RULES.timeLimit, 2)
})

test("cross-check: VALVE_ACT_SELECTION's 122 Indian rows (sheet prices, no stock, no RM rates)", () => {
  const m: Master = { ...MASTER, mappings: SHEET_ROWS.map((r) => ({ mapKey: r.mapKey, requiredTorque: r.requiredTorque, gearbox: '—', valveFlange: 'F10' })) }
  const diff = SHEET_ROWS.flatMap((r) => {
    const s = sel({ mapKey: r.mapKey }, NONE, new Map(), m).selection
    const got = [s.gb?.model ?? '—', s.gb?.ratio ?? '—', act(s), s.act!.rate! + (s.gb?.rate ?? 0), s.flags.includes('Over 2 min')]
    const want = [r.gearbox, r.ratio, r.actuator, r.total, r.over]
    // the sheet rounds operating time half to even (1.625 -> 1.62)
    return JSON.stringify(got) === JSON.stringify(want) && Math.abs(s.time! - r.time) <= 0.011 ? [] : [`${r.mapKey}: ${JSON.stringify(got)} ${s.time} vs ${JSON.stringify(want)} ${r.time}`]
  })
  assert.equal(SHEET_ROWS.length, 122)
  assert.deepEqual(diff, [])
})

test('BFV|1300|PN16 qty 1: Special – refer OEM stays an OEM RFQ, no cost, no codes', () => {
  const pick = sel({ mapKey: 'BFV|1300|PN16', qty: 1 })
  const s = pick.selection
  assert.deepEqual([s.status, s.mapKey, s.valveType, s.dn, s.pn, s.qty, s.requiredTorque, s.topFlange, s.act, s.gb, s.aumaRequired, s.time],
    ['OEM RFQ', 'BFV|1300|PN16', 'BFV', 1300, 'PN16', 1, 85030, 'F35', null, null, false, null])
  const p = planActuator({ itemType: 'ACTUATOR', productCost: null, bareValveCost: null, lastTotal: null }, pick, { actCode: 'RCB040006' })
  assert.equal(p.cost.total, null)
  assert.deepEqual(p.cost.pending, [SPECIAL_OEM])
  assert.deepEqual([p.actCode, p.gbCode, p.make], [null, null, 'Rotork'])
})

test('blank price is pending, never 0; no MAPPING row is pending', () => {
  const unpriced = price(MASTER, { 'ACT-AU-SA50': null, 'ACT-AU-SA60': null, 'ACT-AU-SA100': null })
  const pick = sel({ mapKey: 'SLUICE|700|PN10', text: 'AUMA' }, NONE, new Map(), unpriced)
  assert.deepEqual([pick.selection.act!.model, pick.selection.act!.rate, pick.selection.status], ['SA 50', null, 'PENDING'])
  assert.deepEqual(pick.missing, ['actuator price (SA 50)'])
  const p = planActuator(valve(100000), pick)
  assert.equal(p.cost.total, null)
  assert.match(p.cost.text, /^Price pending: actuator price \(SA 50\) · operating time 4\.89 min \[Over 2 min; RM code to be created: AUMA SA 50; RM code to be created: Viral SGB-2000]$/)
  assert.deepEqual(sel({ mapKey: 'BFV|2500|PN16' }).missing, ['no MAPPING row for BFV|2500|PN16'])
  assert.deepEqual(sel({ mapKey: null }).missing, ['MAP KEY not derivable (needs a valve type, size and PN)'])
})

test('adaptor by valve top flange, assembly by DN', () => {
  assert.deepEqual(['F07/F10', 'F12', 'F14', 'F16', 'F25', 'F30', 'F35', 'F48', 'F60', '—', null].map(adaptorEstimate),
    [1500, 2500, 2500, 3500, 6000, 10000, 10000, 10000, 10000, null, null])
  assert.deepEqual([80, 300, 350, 600, 700, 1000, 1100, 1900, null].map(assemblyEstimate), [1500, 1500, 3000, 3000, 5000, 5000, 8000, 8000, null])
})

test('a typed amount wins over the estimates; ACTUATOR item = actuator + gearbox only', () => {
  const typed = sel({ mapKey: 'BFV|500|PN16', adaptor: 0, assembly: 2500 }).selection
  assert.deepEqual([typed.adaptor, typed.assembly], [{ amount: 0, estimated: false }, { amount: 2500, estimated: false }])
  const actuatorOnly = sel({ mapKey: 'BFV|500|PN16', actuatorItem: true })
  assert.deepEqual([actuatorOnly.selection.adaptor, actuatorOnly.selection.assembly], [null, null])
  assert.equal(planActuator({ itemType: 'ACTUATOR', productCost: 999, bareValveCost: null, lastTotal: null }, actuatorOnly).cost.total, 56500 + 17625)
  assert.deepEqual(planActuator(valve(null), sel({ mapKey: 'BFV|500|PN16' })).cost.pending, ['bare valve cost'])
})

test('codes typed by hand: RM rate first, sheet price as fallback; the other part is picked to suit; kept until cleared', () => {
  // a Raw Material ERP code in neither master: priced from the RM master only, no speed known
  const rm = sel({ mapKey: 'BFV|500|PN16', actCode: 'RCB099999', gbCode: 'red070005' }, FREE, new Map([['RCB099999', 40000], ['RED070005', 5350]])).selection
  assert.deepEqual([rm.act!.source, rm.act!.erpCode, rm.act!.rate, rm.act!.rateSource, rm.act!.rpm, rm.time], ['stock', 'RCB099999', 40000, 'RM', null, null])
  assert.deepEqual([rm.gb!.model, rm.gb!.erpCode, rm.gb!.rate, rm.gb!.rateSource, rm.gb!.rateFlag], ['VWE-10', 'RED070005', 5350, 'RM', null])
  assert.deepEqual(rm.flags, [HAND_GB, HAND_ACT])
  // a stock line typed as its ERP code (manual approval of an old-wiring actuator): its own speed, the gearbox that suits it
  const k150 = sel({ mapKey: 'BFV|500|PN16', actCode: 'RCB040002' }, FREE).selection
  assert.deepEqual([k150.act!.model, k150.act!.erpCode, k150.act!.rpm, k150.act!.rate, k150.act!.rateSource], ['K150', 'RCB040002', 24, 57912, 'SHEET'])
  assert.deepEqual([k150.gb!.model, k150.time, k150.flags], ['VWESGA-80', 2.29, [HAND_ACT, 'Over 2 min']]) // no worm box gets 24 rpm in time
  // a typed gearbox with MA and ratio: the actuator is picked for it; one without (old stock line) leaves the actuator to the user
  assert.equal(act(sel({ mapKey: 'SLUICE|350|PN16', gbCode: 'GB-VI-SGB1000' }).selection), 'AUMA SA 25 @180')
  const old = sel({ mapKey: 'BFV|100|PN10', gbCode: 'REC030023' }, FREE)
  assert.deepEqual([old.selection.gb!.model, old.selection.act, old.missing], ['WORM 250 Nm', null, ['actuator: gearbox WORM 250 Nm has no MA / ratio in GB_MASTER, set it by hand', 'gearbox price (WORM 250 Nm)']])
  assert.deepEqual(sel({ mapKey: 'BFV|500|PN16', actCode: 'K150' }).missing, ['actuator price (K150)']) // not a code: pending

  const pinned = { actuatorMake: 'Rotork', actCode: 'RCB099999', actuatorBreakdown: { selection: rm } }
  assert.deepEqual(handPicks({}, { actCode: 'RCB099999' }, MASTER), { make: null, actCode: 'RCB099999', gbCode: null })
  assert.equal(handPicks(pinned, {}, MASTER).actCode, 'RCB099999') // next run keeps it
  assert.equal(handPicks(pinned, { actCode: 'RCB099999', gbCode: null }, MASTER).actCode, 'RCB099999') // dialog re-sends it unchanged
  assert.equal(handPicks(pinned, { actCode: null }, MASTER).actCode, null) // cleared
  assert.equal(handPicks(pinned, { actuatorMake: 'AUMA' }, MASTER).actCode, null) // make change re-picks
  const sa25 = sel({ mapKey: 'BFV|500|PN16', actCode: 'ACT-AU-SA25' }).selection
  assert.equal(handPicks({ actCode: 'ACT-AU-SA25', actuatorBreakdown: { selection: sa25 } }, {}, MASTER).actCode, 'ACT-AU-SA25')
  // what an auto pick wrote is picked again, the make too (AUMA here, written because it was cheaper)
  const auto = sel({ mapKey: 'BFV|500|PN16' }).selection
  assert.deepEqual(handPicks({ actuatorMake: 'AUMA', actCode: 'ACT-AU-SA12', gbCode: 'GB-VI-VWESGA80', actuatorBreakdown: { selection: auto } }, {}, MASTER),
    { make: null, actCode: null, gbCode: null })
  const handRotork = sel({ mapKey: 'BFV|500|PN16', make: 'Rotork' }).selection
  assert.equal(handPicks({ actuatorMake: 'Rotork', actuatorBreakdown: { selection: handRotork } }, {}, MASTER).make, 'Rotork') // make set by hand stays
  // a selection stored before 20 Nov (no time): its make was auto only when it was the old default
  const { time: _time, ...old18 } = auto
  assert.equal(handPicks({ actuatorMake: 'AUMA', actuatorBreakdown: { selection: old18 } }, {}, MASTER).make, 'AUMA')
  assert.equal(handPicks({ actuatorMake: 'Rotork', actuatorBreakdown: { selection: old18 } }, {}, MASTER).make, null)
  // linked before the live sheet: MAPPING codes and the AUMA default were auto-filled; a typed ERP code was not
  assert.deepEqual(handPicks({ actuatorMake: 'AUMA', actCode: 'ACT-AU-SA12', gbCode: 'GB-AU-125.2' }, {}, MASTER), { make: null, actCode: null, gbCode: null })
  assert.equal(handPicks({ gbCode: 'RED070005' }, {}, MASTER).gbCode, 'RED070005')
})

test('RM lookup codes include the generic model codes, stock / Viral ERP codes and typed codes (production fed an empty rate map without them)', () => {
  const codes = rmLookupCodes(MASTER, ['rcb099999', null, 'no code'])
  for (const c of ['RCC010021', 'RCC010058', 'RCC010057', 'RED070005', 'RCB040006', 'RCB099999']) assert.ok(codes.includes(c), c)
  assert.equal(new Set(codes).size, codes.length)
  assert.ok(!codes.includes('NEW code') && !codes.includes('')) // not codes
})

test('"RM code to be created" when the sheet lists a code the RM master lacks, not only when the sheet has none', () => {
  const none = sel({ mapKey: 'BFV|500|PN16' }).selection // SA 12 has RCC010028 in the sheet, but the RM map is empty
  assert.deepEqual([none.act!.rmCode, none.act!.rateSource], ['RCC010028', 'SHEET'])
  assert.ok(none.flags.includes(`${RM_NEW}: AUMA SA 12`))
  const priced = sel({ mapKey: 'BFV|500|PN16' }, NONE, new Map([['RCC010028', 56500], ['RL1010012', 17625]])).selection
  assert.deepEqual(priced.flags, [])
})

test('a typed actuator that cannot take the torque at any speed is kept, flagged, with no operating time', () => {
  const s = sel({ mapKey: 'SLUICE|350|PN16', actCode: 'ACT-RT-K30' }).selection // 34 Nm; 163 Nm needed
  assert.equal(s.act!.model, 'K30')
  assert.ok(s.flags.includes(TYPED_WEAK))
  assert.equal(s.time, null)
  assert.ok(!sel({ mapKey: 'SLUICE|350|PN16', actCode: 'ACT-AU-SA25' }).selection.flags.includes(TYPED_WEAK)) // a fitting one is not flagged
  assert.ok(!sel({ mapKey: 'SLUICE|350|PN16', actCode: 'RCB099999' }).selection.flags.includes(TYPED_WEAK)) // no curve: as before
})
