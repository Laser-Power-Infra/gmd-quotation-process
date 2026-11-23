// The Mapping page's rows: the app's own pick per MAPPING / imported key, and the refresh that stores them (Puja, 23 Nov 2026).
// No database: the table writer runs on a fake client, the refresh on a fake sheet read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { OVER_TIME } from '@gmd/actuator-mapping/columns'
import type { Parsed } from '../lib/actuatorMaster.js'
import { SPECIAL_OEM } from '../lib/actuatorCost.js'
import { IMPORTED_FLAG } from '../lib/actuatorSelect.js'
import { mappingRows, refreshActuatorTables, refreshForPage, writeActuatorTables, type Row } from '../lib/actuatorTablesSync.js'
import { MASTER } from './actuatorFixture.js'

const NO_RM = new Map<string, number>()
const rows = mappingRows(MASTER, NO_RM)
const row = (mapKey: string) => rows.find((r) => r.mapKey === mapKey)!
const pick = (r: Row) => [r.origin, r.selGearbox, r.selGbRatio, r.selActuator, r.selActRpm, r.selTotal, r.selTime, r.selTimeCheck]

test('mappingRows: an Indian row carries the pick docket pricing makes (Viral gearbox, AUMA SA / Rotork K, rpm, total, time)', () => {
  assert.deepEqual(pick(row('BFV|500|PN16')), ['INDIAN', 'VWESGA-80', '220:1', 'AUMA SA 12', 32, 74125, 1.72, 'OK'])
  assert.deepEqual([row('BFV|500|PN16').valveType, row('BFV|500|PN16').dn, row('BFV|500|PN16').pn, row('BFV|500|PN16').valveTurns], ['BFV', 500, 'PN16', 0.25])
  // direct drive up to DN300: no gearbox, valve turns = DN ÷ 6.35
  assert.deepEqual(pick(row('SLUICE|80|PN10')), ['INDIAN', 'Direct', null, 'AUMA SA 6', 8, 54900, 1.63, 'OK'])
  assert.equal(row('SLUICE|80|PN10').valveTurns, 13)
  // the sheet's own columns of the row are kept (the flange columns still show)
  assert.deepEqual([row('BFV|500|PN16').requiredTorque, row('BFV|500|PN16').valveFlange], [6198, 'F25'])
})

test('mappingRows: nothing in time is "Over 2 min", the text the page filters and counts on', () => {
  assert.deepEqual(pick(row('SLUICE|700|PN10')), ['INDIAN', 'SGB-2000', '8:1', 'Rotork K600', 192, 106349, 4.58, 'Over 2 min'])
  assert.equal(row('SLUICE|700|PN10').selTimeCheck, OVER_TIME)
  assert.ok(!String(row('SLUICE|700|PN10').selFlags).includes('Over')) // said once, in its own column
})

test('mappingRows: imported (TFW) rows have their own keys, origin IMPORTED, TFW turns and the imported pick', () => {
  assert.deepEqual(pick(row('SLUICE-IMP|350|PN16')), ['IMPORTED', 'SGB-600', '4:1', 'AUMA SA 12', 63, 63000, 1.9, 'OK'])
  assert.deepEqual([row('SLUICE-IMP|350|PN16').valveType, row('SLUICE-IMP|350|PN16').requiredTorque, row('SLUICE-IMP|350|PN16').valveTurns], ['SLUICE-IMP', 325, 30])
  assert.deepEqual(pick(row('BFV-IMP|300|PN16')), ['IMPORTED', 'VWE-10', '42:1', 'AUMA SA 12', 5.6, 61300, 1.88, 'OK'])
  assert.deepEqual([row('BFV-IMP|300|PN16').valveTurns, row('BFV-IMP|300|PN16').valveFlange], [0.25, 'F10'])
  assert.ok(String(row('SLUICE-IMP|350|PN16').selFlags).startsWith(IMPORTED_FLAG))
  // the Indian valve of the same size keeps its own torque and pick: the two are separate rows
  assert.deepEqual(pick(row('SLUICE|350|PN16')), ['INDIAN', 'SGB-600', '4:1', 'AUMA SA 25', 125, 73500, 1.76, 'OK'])
  assert.equal(rows.length, MASTER.mappings.length + MASTER.imported.length)
  assert.equal(new Set(rows.map((r) => r.mapKey)).size, rows.length)
})

test('mappingRows: a "Special – refer OEM" row has no pick, a blank time check and says why', () => {
  const r = row('BFV|1300|PN16')
  assert.deepEqual(pick(r), ['INDIAN', null, null, null, null, null, null, null])
  assert.ok(String(r.selFlags).includes(SPECIAL_OEM))
})

test('mappingRows: no imported data (TFW tab missing) still gives every Indian row, unchanged', () => {
  const indian = mappingRows({ ...MASTER, imported: [] }, NO_RM)
  assert.deepEqual(indian, rows.filter((r) => r.origin === 'INDIAN'))
  assert.equal(indian.length, MASTER.mappings.length)
})

test('mappingRows: a Raw Material rate wins over the sheet price in the total', () => {
  const r = mappingRows(MASTER, new Map([['RSE010030', 6000]])).find((x) => x.mapKey === 'SLUICE-IMP|350|PN16')!
  assert.equal(r.selTotal, 56500 + 6000)
})

// A parsed master with every table filled, and a client that records what it is asked to do.
const PARSED = {
  ...MASTER, valveTorques: [{ key: 'BFV|100' }], params: [{ name: 'SF', value: 1.3, note: null }],
  suitability: [{ mapKey: 'BFV|100|PN10', kind: 'ACT', code: 'ACT-AU-SA6', make: 'AUMA', label: 'AUMA SA 6', ratingNm: 60, mark: '✔' }],
} as unknown as Parsed
function fakeDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded Prisma arguments, read loosely in the asserts
  const calls: { table: string; op: string; arg: any }[] = []
  const delegate = (table: string) => ({
    upsert: async (arg: unknown) => { calls.push({ table, op: 'upsert', arg }) },
    deleteMany: async (arg?: unknown) => { calls.push({ table, op: 'deleteMany', arg }); return { count: 0 } },
    createMany: async (arg: unknown) => { calls.push({ table, op: 'createMany', arg }) },
  })
  const db: Record<string, unknown> = { $transaction: async (ops: Promise<unknown>[]) => { await Promise.all(ops) } }
  for (const t of ['actuatorMaster', 'gearboxMaster', 'valveTorque', 'actuatorParam', 'actuatorMapping', 'gmdGearboxStock', 'actuatorStock', 'actuatorSuitability']) db[t] = delegate(t)
  return { db, calls }
}

test('writeActuatorTables: upserts the eight tables by key and removes only what the master no longer has', async () => {
  const { db, calls } = fakeDb()
  const lines: string[] = []
  await writeActuatorTables(PARSED, rows, db, (l) => lines.push(l))
  const of = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op)
  assert.equal(of('actuatorMapping', 'upsert').length, rows.length)
  assert.deepEqual(of('actuatorMapping', 'upsert')[0].arg.where, { mapKey: 'BFV|100|PN10' })
  assert.deepEqual(of('actuatorMapping', 'deleteMany')[0].arg.where, { mapKey: { notIn: rows.map((r) => r.mapKey) } })
  assert.equal(of('actuatorMaster', 'upsert').length, MASTER.actuators.length)
  // a blank price keeps the stored one (KEEP_IF_BLANK), as the import script always did
  const spare = of('actuatorMaster', 'upsert').find((c) => c.arg.where.actCode === 'ACT-AU-SPARE')!
  assert.ok(!('price' in spare.arg.update) && 'price' in spare.arg.create)
  assert.equal(of('actuatorSuitability', 'createMany')[0].arg.data.length, 1)
  assert.equal(lines.length, 8)
})

test('writeActuatorTables: an emptied tab refuses before the first write, whichever table it is', async () => {
  for (const tab of ['actuators', 'gearboxes', 'valveTorques', 'params', 'gearboxStock', 'actuatorStock', 'suitability'] as const) {
    const { db, calls } = fakeDb()
    await assert.rejects(writeActuatorTables({ ...PARSED, [tab]: [] }, rows, db), /refusing to delete everything/, tab)
    assert.deepEqual(calls, [], tab)
  }
  // MAPPING emptied: the imported rows alone do not make the table "filled"
  for (const mappings of [[], rows.filter((r) => r.origin === 'IMPORTED')]) {
    const { db, calls } = fakeDb()
    await assert.rejects(writeActuatorTables(PARSED, mappings, db), /ActuatorMapping: .*refusing to delete everything/)
    assert.deepEqual(calls, [])
  }
})

test('writeActuatorTables: the TFW tab missing or emptied keeps the stored imported rows', async () => {
  const { db, calls } = fakeDb()
  const indian = rows.filter((r) => r.origin === 'INDIAN')
  await writeActuatorTables(PARSED, indian, db)
  const del = calls.find((c) => c.table === 'actuatorMapping' && c.op === 'deleteMany')!
  assert.deepEqual(del.arg.where, { mapKey: { notIn: indian.map((r) => r.mapKey) }, OR: [{ origin: null }, { origin: { not: 'IMPORTED' } }] })
})

test('refreshActuatorTables: never throws, one run at a time, at most once per max age', async () => {
  const warn = console.warn
  const warned: unknown[][] = []
  console.warn = (...a: unknown[]) => { warned.push(a) }
  try {
    let loads = 0, syncs = 0
    const down = { load: async () => { loads++; throw new Error('sheet unreachable') }, sync: async () => { syncs++ } }
    // the sheet read fails: no throw, nothing written (the stored rows stay), and the next page click does not wait on it again
    await refreshActuatorTables(600_000, down)
    await refreshActuatorTables(600_000, down)
    assert.deepEqual([loads, syncs, warned.length], [1, 0, 1])
    assert.match(String(warned[0][1]), /sheet unreachable/)

    // two people open the page together: one read, one write, both wait for it
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const up = { load: async () => { loads++; await gate; return PARSED }, sync: async (p: Parsed) => { syncs++; assert.equal(p, PARSED) } }
    const a = refreshActuatorTables(0, up), b = refreshActuatorTables(0, up)
    release()
    await Promise.all([a, b])
    assert.deepEqual([loads, syncs], [2, 1])

    // younger than the max age: skipped
    await refreshActuatorTables(600_000, up)
    await refreshActuatorTables(undefined, up)
    assert.deepEqual([loads, syncs], [2, 1])

    // the write refuses (an emptied tab): still no throw
    await refreshActuatorTables(0, { load: async () => PARSED, sync: async () => { throw new Error('ActuatorStock: no rows parsed, refusing to delete everything.') } })
    assert.equal(warned.length, 2)
  } finally {
    console.warn = warn
  }
})

test('refreshActuatorTables: a failure resolves with a short reason, kept until the next good run', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    const ok = { load: async () => PARSED, sync: async () => {} }
    const sheetDown = { load: async () => { throw new Error('invalid_grant\n    at stack line') }, sync: async () => {} }
    assert.equal(await refreshActuatorTables(0, sheetDown), 'the sheet could not be read: invalid_grant')
    // inside the retry wait nothing is read again, and the page is still told
    assert.equal(await refreshActuatorTables(600_000, ok), 'the sheet could not be read: invalid_grant')
    // a tab emptied by mistake: our own refusal is quoted
    const refused = { load: async () => PARSED, sync: async () => { throw new Error('ActuatorStock: no rows parsed, refusing to delete everything.') } }
    assert.equal(await refreshActuatorTables(0, refused), 'a sheet tab came out empty: ActuatorStock: no rows parsed, refusing to delete everything.')
    // a database error: its text (host, query) stays in the server log
    const dbDown = { load: async () => PARSED, sync: async () => { throw new Error('Cannot reach database server at 10.0.0.5:5432') } }
    assert.equal(await refreshActuatorTables(0, dbDown), 'the database could not be read or written')
    // a good run clears it
    assert.equal(await refreshActuatorTables(0, ok), null)
    assert.equal(await refreshActuatorTables(600_000, sheetDown), null)
  } finally {
    console.warn = warn
  }
})

test('refreshForPage: waits a bounded time, then the run finishes behind and its failure shows on the next load', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    // a hung sheet read: the page gets its answer after the wait (20 ms here, 8 s live), with no error line
    let fail!: (e: Error) => void, loads = 0
    const hung = { load: () => { loads++; return new Promise<Parsed>((_, reject) => { fail = reject }) }, sync: async () => {} }
    const started = Date.now()
    assert.equal(await refreshForPage(20, () => refreshActuatorTables(0, hung)), null)
    assert.ok(Date.now() - started < 2000)
    // a second open during the run shares it: no second read
    assert.equal(await refreshForPage(20, () => refreshActuatorTables(0, hung)), null)
    assert.equal(loads, 1)
    // the run fails later, behind: nothing is thrown, and the next load says so in plain words
    const run = refreshActuatorTables(0, hung)
    fail(new Error('connect ETIMEDOUT'))
    assert.equal(await run, 'the sheet could not be read: connect ETIMEDOUT')
    assert.equal(
      await refreshForPage(20, () => refreshActuatorTables(600_000, hung)),
      'Could not refresh from the live sheet (the sheet could not be read: connect ETIMEDOUT). Showing the last stored rows.',
    )
    assert.equal(loads, 1)
    // a refresh that finishes inside the wait: no line
    assert.equal(await refreshForPage(1000, async () => null), null)
  } finally {
    console.warn = warn
  }
})
