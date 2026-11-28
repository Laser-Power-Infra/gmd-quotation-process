// Imported (Tianjin Tangfa "TFW") valves, Puja 23 Nov 2026: torque with safety factor and actual turns from the TFW tab,
// never from MAPPING. Kept apart from actuatorSelect.test.ts, which covers the Indian data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { handPicks, IMPORTED_FLAG, NO_TFW, NO_TFW_FLANGE, originAfter, patchForOrigin, RM_NEW, selectActuator, type Master, type SelectInput } from '../lib/actuatorSelect.js'
import { planActuator } from '../lib/actuatorCost.js'
import { readTabs, IMPORTED_TAB } from '../lib/actuatorSheet.js'
import { MASTER } from './actuatorFixture.js'
import { IMPORTED_SHEET_ROWS } from './actuatorSheetSelection.js'

const NONE = new Map<string, number>()
const sel = (i: Partial<SelectInput>, m: Master = MASTER) =>
  selectActuator({ mapKey: null, actuatorItem: false, qty: 2, text: '', origin: 'IMPORTED', ...i }, m, NONE, NONE)
const act = (s: { act: { make: string; model: string | null; rpm: number | null } | null }) => `${s.act?.make} ${s.act?.model} @${s.act?.rpm}`
const flagsOf = (s: { flags: string[] }) => s.flags.filter((f) => !f.startsWith(RM_NEW))

test("the sheet's worked example: imported sluice DN350 PN16, 325 Nm, 30 turns -> SGB-600 (4:1), AUMA SA 12 @63 rpm, 63,000, 1.9 min", () => {
  const { selection: s, missing } = sel({ mapKey: 'SLUICE|350|PN16', adaptor: 2000 })
  assert.deepEqual(missing, [])
  assert.deepEqual([s.status, s.valveType, s.dn, s.pn, s.requiredTorque, s.topFlange], ['OK', 'SLUICE-IMP', 350, 'PN16', 325, null])
  assert.deepEqual([s.gb!.model, s.gb!.ratio, s.actNeed, act(s), s.act!.rate! + s.gb!.rate!], ['SGB-600', '4:1', 93, 'AUMA SA 12 @63', 63000])
  assert.deepEqual([s.time, Math.round(s.time! * 63), flagsOf(s)], [1.9, 120, [IMPORTED_FLAG]]) // 30 turns x 4 = 120 actuator turns, not 55 x 4
  const p = planActuator({ itemType: 'SLUICE VALVE-METAL SEATED', productCost: 100000, bareValveCost: null, lastTotal: null }, { selection: s, missing })
  assert.equal(p.cost.total, 100000 + 63000 + 2000 + 3000)
  assert.match(p.cost.text, /Imported \(TFW\) data/)
})

test('imported sluice DN80 PN16: direct, AUMA SA 12 @11, 56,500; PN10 uses the PN16 row', () => {
  const s = sel({ mapKey: 'SLUICE|80|PN16' }).selection
  assert.deepEqual([s.gb, s.requiredTorque, act(s), s.act!.rate, s.time], [null, 75, 'AUMA SA 12 @11', 56500, 1.82])
  const pn10 = sel({ mapKey: 'SLUICE|80|PN10' }).selection
  assert.deepEqual([pn10.requiredTorque, act(pn10), pn10.time], [75, 'AUMA SA 12 @11', 1.82])
})

test('origin INDIAN (or none) keeps the Indian pick: the two data sets are never mixed', () => {
  for (const origin of ['INDIAN', undefined] as const) {
    const big = sel({ mapKey: 'SLUICE|350|PN16', origin }).selection
    assert.deepEqual([big.valveType, big.requiredTorque, big.topFlange, act(big), big.time, flagsOf(big)], ['SLUICE', 569, 'F16', 'AUMA SA 25 @125', 1.76, []])
    const small = sel({ mapKey: 'SLUICE|80|PN10', origin }).selection
    assert.deepEqual([small.requiredTorque, act(small), small.time], [52, 'AUMA SA 6 @8', 1.63]) // 13 turns (DN ÷ 6.35), not TFW's 20
  }
})

test('no TFW row (KGV, DN65 sluice, PN25 DN400): price pending with a plain reason, never the Indian torque', () => {
  // MAPPING has a row for each of these keys: it must not be read
  const m: Master = { ...MASTER, mappings: [...MASTER.mappings, ...['SLUICE|65|PN16', 'SLUICE|400|PN25', 'KGV|300|PN10'].map((mapKey) => ({ mapKey, requiredTorque: 100, gearbox: '— (direct)', valveFlange: 'F10' }))] }
  for (const mapKey of ['KGV|50|PN10', 'KGV|300|PN10', 'SLUICE|65|PN16', 'SLUICE|400|PN25', 'BFV|100|PN10', 'BFV|700|PN16']) {
    const { selection: s, missing } = sel({ mapKey }, m)
    assert.deepEqual([missing, s.status, s.requiredTorque, s.topFlange, s.act, s.gb, s.time], [[NO_TFW], 'PENDING', null, null, null, null, null], mapKey)
    assert.ok(s.flags.includes(IMPORTED_FLAG))
    const p = planActuator({ itemType: 'KNIFE GATE VALVE', productCost: 100000, bareValveCost: null, lastTotal: null }, { selection: s, missing })
    assert.equal(p.cost.total, null)
    assert.match(p.cost.text, /^Price pending: no imported \(TFW\) data for this size/)
  }
  assert.equal(NO_TFW, 'no imported (TFW) data for this size')
  // a "Special – refer OEM" MAPPING row is Indian data too: the imported valve of that key is just pending
  assert.equal(sel({ mapKey: 'BFV|1300|PN16' }).selection.status, 'PENDING')
  // the TFW tab missing or empty: imported items are pending, Indian items price as before
  const none: Master = { ...MASTER, imported: [] }
  assert.deepEqual(sel({ mapKey: 'SLUICE|350|PN16' }, none).missing, [NO_TFW])
  assert.equal(sel({ mapKey: 'SLUICE|350|PN16', origin: 'INDIAN' }, none).selection.status, 'OK')
  assert.deepEqual(sel({ mapKey: null }).missing, ['MAP KEY not derivable (needs a valve type, size and PN)'])
})

test('D1: imported valve with no TFW top flange and no typed adaptor stays pending; the Indian flange is never borrowed', () => {
  const { selection: s, missing } = sel({ mapKey: 'SLUICE|350|PN16' }) // MAPPING says F16 for the Indian DN350
  assert.deepEqual([s.status, s.topFlange, s.adaptor, s.assembly, missing], ['PENDING', null, null, { amount: 3000, estimated: true }, [NO_TFW_FLANGE]])
  assert.match(NO_TFW_FLANGE, /type the adaptor amount in the Actuator dialog/)
  assert.deepEqual([act(s), s.act!.rate! + s.gb!.rate!], ['AUMA SA 12 @63', 63000]) // the pick still shows
  const typed = sel({ mapKey: 'SLUICE|350|PN16', adaptor: 0 })
  assert.deepEqual([typed.selection.status, typed.selection.adaptor, typed.missing], ['OK', { amount: 0, estimated: false }, []])
  // DN600+ has a TFW bracket flange (block B): estimated from it
  const big = sel({ mapKey: 'SLUICE|700|PN10' })
  assert.deepEqual([big.selection.status, big.selection.requiredTorque, big.selection.topFlange, big.selection.adaptor, big.missing], ['OK', 930, 'F25', { amount: 6000, estimated: true }, []])
})

test('imported butterfly: TFW torque with SF and ISO 5211 flange, still a Viral worm box and a quarter turn', () => {
  const { selection: s, missing } = sel({ mapKey: 'BFV|300|PN16' }) // Indian BFV DN300 is 1000 Nm in the sheet; no MAPPING row in the fixture
  assert.deepEqual([missing, s.status, s.valveType, s.requiredTorque, s.topFlange], [[], 'OK', 'BFV-IMP', 958.8, 'F10'])
  assert.deepEqual([s.gb!.model, s.gb!.ratio, act(s), s.time, s.adaptor, s.assembly], ['VWE-10', '42:1', 'AUMA SA 12 @5.6', 1.88, { amount: 1500, estimated: true }, { amount: 1500, estimated: true }])
})

test('resilient-seated sluice uses the same TFW gate rows; the IMP key itself (Mapping page) gives the same pick', () => {
  const rs = sel({ mapKey: 'SLUICE-RS|600|PN10' }).selection // Indian row: 456 Nm, 94 turns
  assert.deepEqual([rs.valveType, rs.requiredTorque, rs.topFlange, rs.gb!.model, act(rs), rs.time], ['SLUICE-IMP', 800, 'F16', 'SGB-1000', 'AUMA SA 25 @125', 2]) // 50 turns x 5
  for (const [imp, item] of [['SLUICE-IMP|350|PN16', 'SLUICE|350|PN16'], ['BFV-IMP|300|PN16', 'BFV|300|PN16']]) {
    const a = sel({ mapKey: imp }), b = sel({ mapKey: item })
    assert.deepEqual({ ...a.selection, mapKey: null }, { ...b.selection, mapKey: null })
    assert.deepEqual(a.missing, b.missing)
  }
})

test('a typed actuator on an imported valve is checked against the TFW torque', () => {
  const s = sel({ mapKey: 'SLUICE|350|PN16', actCode: 'ACT-AU-SA15', adaptor: 2000 }).selection
  assert.deepEqual([s.status, s.requiredTorque, s.gb!.model, act(s)], ['OK', 325, 'SGB-600', 'AUMA SA 15 @63'])
})

test('an IMPORTED line of item type ACTUATOR: TFW torque and turns; no TFW flange and no typed adaptor stays pending', () => {
  const { selection: s, missing } = sel({ mapKey: 'SLUICE|350|PN16', actuatorItem: true })
  assert.deepEqual([s.status, s.valveType, s.requiredTorque, s.topFlange, missing], ['PENDING', 'SLUICE-IMP', 325, null, [NO_TFW_FLANGE]])
  assert.deepEqual([s.gb!.model, act(s), s.time, Math.round(s.time! * 63)], ['SGB-600', 'AUMA SA 12 @63', 1.9, 120]) // 30 TFW turns x 4, not 55 x 4
  const p = planActuator({ itemType: 'ACTUATOR', productCost: null, bareValveCost: null, lastTotal: null }, { selection: s, missing })
  assert.equal(p.cost.total, null)
})

test("cross-check: VALVE_ACT_SELECTION's 36 imported rows (sheet prices, no stock, no RM rates)", () => {
  const diff = IMPORTED_SHEET_ROWS.flatMap((r) => {
    const s = sel({ mapKey: r.mapKey }).selection
    const got = [s.requiredTorque, s.gb?.model ?? '—', s.gb?.ratio ?? '—', act(s), (s.act?.rate ?? NaN) + (s.gb?.rate ?? 0), s.flags.includes('Over 2 min')]
    const want = [r.requiredTorque, r.gearbox, r.ratio, r.actuator, r.total, r.over]
    // the sheet rounds operating time half to even (3.125 -> 3.12 on DN900 and DN1000 PN16), as in the Indian comparison
    return JSON.stringify(got) === JSON.stringify(want) && Math.abs(s.time! - r.time) <= 0.011 ? [] : [`${r.mapKey}: ${JSON.stringify(got)} ${s.time} vs ${JSON.stringify(want)} ${r.time}`]
  })
  assert.equal(IMPORTED_SHEET_ROWS.length, 36)
  assert.deepEqual(diff, [])
})

test('live sheet read: the TFW tab is asked for by its quoted name; when the read fails it is retried without it', async () => {
  const asked: string[][] = []
  const ok = await readTabs(async (ranges) => { asked.push(ranges); return ranges.map((r) => [[r]]) })
  assert.equal(asked.length, 1)
  assert.equal(asked[0].at(-1), "'IMPORTED_VALVE_DATA (TFW)'")
  assert.deepEqual(ok[IMPORTED_TAB], [["'IMPORTED_VALVE_DATA (TFW)'"]])
  assert.deepEqual(ok.MAPPING, [['MAPPING']])
  // the tab renamed or deleted: the API rejects the whole read ("Unable to parse range: <range>")
  const without = await readTabs(async (ranges) => {
    if (ranges.some((r) => r.includes('TFW'))) throw new Error("Unable to parse range: 'IMPORTED_VALVE_DATA (TFW)'")
    return ranges.map((r) => [[r]])
  })
  assert.deepEqual([without[IMPORTED_TAB], without.MAPPING], [[], [['MAPPING']]])
  // any other failure (quota, 5xx, network) is not "the tab is missing": no retry, so an empty imported list is never cached
  for (const msg of ['Quota exceeded for quota metric (429)', 'The service is currently unavailable.', 'socket hang up']) {
    let calls = 0
    await assert.rejects(readTabs(async (ranges) => { if (++calls === 1) throw new Error(msg); return ranges.map((r) => [[r]]) }), new RegExp(msg.slice(0, 12)))
    assert.equal(calls, 1, msg)
  }
  // the sheet itself unreachable: the error still comes out
  await assert.rejects(readTabs(async () => { throw new Error('offline') }), /offline/)
})

test('Origin field: only IMPORTED is stored; changing it drops the codes typed for the other origin, like a MAP KEY change', () => {
  assert.deepEqual([originAfter(null, {}), originAfter('IMPORTED', {}), originAfter(null, { valveOrigin: 'IMPORTED' }), originAfter('IMPORTED', { valveOrigin: null }),
    originAfter('IMPORTED', { valveOrigin: 'INDIAN' }), originAfter(null, { valveOrigin: 'anything' }), originAfter(null, { valveOrigin: ' imported ' })],
  [null, 'IMPORTED', 'IMPORTED', null, null, null, 'IMPORTED'])
  const typed = sel({ mapKey: 'SLUICE|350|PN16', origin: 'INDIAN', actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000' }).selection
  const it = { valveOrigin: null, actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000', actuatorBreakdown: { selection: typed } }
  const hand = (patch: { valveOrigin?: string | null; actCode?: string | null; gbCode?: string | null }) => handPicks(it, patchForOrigin(it, patch), MASTER)
  const kept = { make: null, actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000' }
  assert.deepEqual(hand({ actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000' }), kept) // origin untouched
  assert.deepEqual(hand({ valveOrigin: null, actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000' }), kept) // still Indian
  assert.deepEqual(hand({ valveOrigin: 'IMPORTED', actCode: 'RCB099999', gbCode: 'GB-VI-SGB1000' }), { make: null, actCode: null, gbCode: null }) // the dialog re-sent the old codes
  assert.deepEqual(hand({ valveOrigin: 'IMPORTED' }), { make: null, actCode: null, gbCode: null })
  assert.deepEqual(hand({ valveOrigin: 'IMPORTED', actCode: 'ACT-AU-SA15', gbCode: 'GB-VI-SGB1000' }), { make: null, actCode: 'ACT-AU-SA15', gbCode: null }) // typed in the same save: stays
})
