import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import type { DrawingActor, DrawingResult } from '@gmd/drawings/columns'

// @gmd/db-tender reuses globalThis.tenderPrisma when it is set, so this in-memory fake stands in
// for the tender DB: it answers the model calls the server makes, records raw SQL (`answer` decides
// what a raw query returns; by default the contract lookup's lines) and rolls a failed transaction
// back. `ops` logs writes, advisory locks and approval syncs in order ("tx " = inside a transaction).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake answers any Prisma row / where shape, so cells are untyped
type Row = Record<string, any>
type Sql = { sql: string; values: unknown[] }
type Step = 'lock' | 'create' | 'update' | 'events'
const db = {
  lines: [] as Row[],
  drawings: [] as Row[],
  events: [] as Row[],
  queries: [] as Sql[],
  executed: [] as (Sql & { inTx: boolean })[],
  ops: [] as string[],
  inTx: false,
  seq: 0,
  // Runs before the next step of that kind: another user's change landing meanwhile.
  beforeWrite: null as null | ((op: Step) => void),
  answer: null as null | ((q: Sql) => Row[]),
}
const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([k, w]) =>
    w && typeof w === 'object' ? ('startsWith' in w ? String(row[k]).startsWith(w.startsWith) : row[k] !== w.not) : row[k] === w,
  )
const sorted = (rows: Row[], orderBy: Row | Row[] = []) => {
  for (const o of [orderBy].flat().reverse()) {
    const [[k, dir]] = Object.entries(o)
    rows.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
  }
  return rows
}
const withEvents = (d: Row) => ({ ...d, events: db.events.filter((e) => e.drawingId === d.id).map((e) => ({ ...e })) })
const log = (op: string) => db.ops.push(db.inTx ? `tx ${op}` : op)
const addEvents = (rows: Row[], skipDuplicates = false) => {
  let count = 0
  for (const r of rows) {
    if (r.sha256 && db.events.some((e) => e.drawingId === r.drawingId && e.sha256 === r.sha256)) {
      if (skipDuplicates) continue
      throw unique()
    }
    db.events.push({ id: `e${++db.seq}`, status: null, comment: null, fileName: null, fileUrl: null, sha256: null, final: false, ...r })
    count++
  }
  return count
}
const fake = {
  $queryRaw: async (q: Sql) => {
    db.queries.push(q)
    return db.answer ? db.answer(q) : db.lines
  },
  $executeRaw: async (q: Sql) => {
    db.executed.push({ sql: q.sql, values: q.values, inTx: db.inTx })
    if (q.sql.includes('pg_advisory_xact_lock')) {
      db.beforeWrite?.('lock')
      log(`lock ${q.values[0]}`)
    } else log(`sync ${q.values.at(-1)}`)
    return 0
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone({ drawings: db.drawings, events: db.events })
    db.inTx = true
    try {
      return await fn(fake)
    } catch (err) {
      Object.assign(db, before)
      throw err
    } finally {
      db.inTx = false
    }
  },
  contractDrawing: {
    findUnique: async ({ where, include }: Row) => {
      const d = db.drawings.find((r) => r.id === where.id)
      return d ? (include ? withEvents(d) : { ...d }) : null
    },
    findMany: async ({ where, include, orderBy }: Row) => {
      if (typeof where.drawingNo === 'string') log(`read ${where.drawingNo}`)
      return sorted(db.drawings.filter((r) => matches(r, where)), orderBy).map((d) => (include ? withEvents(d) : { ...d }))
    },
    create: async ({ data }: Row) => {
      db.beforeWrite?.('create')
      const { events, ...fields } = data
      if (db.drawings.some((r) => r.drawingNo === fields.drawingNo && r.rev === fields.rev)) throw unique()
      const d = { id: `d${++db.seq}`, product: null, pn: null, standard: null, flangeDrilling: null, preparedBy: null, remarks: null, itemCodes: [], createdAt: fields.statusAt, updatedAt: fields.statusAt, ...fields }
      db.drawings.push(d)
      log(`create ${d.drawingNo} R-${d.rev}`)
      if (events) addEvents([{ ...events.create, drawingId: d.id }])
      return withEvents(d)
    },
    updateMany: async ({ where, data }: Row) => {
      db.beforeWrite?.('update')
      const hit = db.drawings.filter((r) => matches(r, where))
      for (const r of hit) Object.assign(r, data)
      log(`update ${hit.map((r) => r.id).join(',')} ${data.status}`)
      return { count: hit.length }
    },
  },
  contractDrawingEvent: {
    createMany: async ({ data, skipDuplicates }: Row) => {
      db.beforeWrite?.('events')
      const count = addEvents(data, skipDuplicates)
      log(`events ${count}`)
      return { count }
    },
  },
}
;(globalThis as unknown as { tenderPrisma: unknown }).tenderPrisma = fake
mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-20T06:00:00Z') })
const NOW = '2026-11-20T06:00:00.000Z'

const server = () => import('@gmd/drawings/server')
const code = (r: { success: boolean; code?: string }) => (r.success ? 'ok' : r.code)
const data = <T>(r: DrawingResult<T>): T => {
  assert.ok(r.success, JSON.stringify(r))
  return r.data
}
const flat = (q: Sql) => ({ sql: q.sql.replace(/\s+/g, ' ').trim(), values: q.values })
/** Runs `hook` once, the next time the server reaches step `op`. */
const once = (op: Step, hook: () => void) => {
  db.beforeWrite = (at) => {
    if (at !== op) return
    db.beforeWrite = null
    hook()
  }
}

const washim: DrawingActor = { name: 'Washim', role: 'verifier' }
const puja: DrawingActor = { name: 'Puja', role: 'editor' }
const claude: DrawingActor = { name: 'Claude (API)', role: 'api' }
const tridip: DrawingActor = { name: 'Tridip', role: 'viewer' }

/** A Contract Review line as the contract lookup returns it (contract and PO no already normalised). */
const line = (itemCode: string, more: Row = {}) => ({
  contractNo: 'SD26Y-00067', poKey: 'PO 4500012345', itemCode, itemName: 'SLUICE VALVE', size: '100', pnRating: 'PN 10', orderQty: '4',
  approvalDate: null, status: null, contractor: 'L&T Construction', client: 'PHED Rajasthan', project: 'Jal Jeevan Mission',
  poNo: 'PO 4500012345', contractDate: '05-Nov-2026', ...more,
})
// The second line's item code carries a stray tab, as sheet data sometimes does.
const LINES = [line('FTD040013', { contractor: '', status: 'CLOSED' }), line('FTD040017\t', { size: '150' })]
const GAD = {
  contract: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD', product: 'Sluice valve DN100', pn: 'PN 10',
  standard: 'IS 14846', flangeDrilling: 'IS 1538', preparedBy: 'Claude', remarks: ' ', itemCodes: [' ftd040013'],
}
const sha = (c: string) => c.repeat(64)
const pdf = (name: string, c: string) => ({ fileName: name, fileUrl: `https://drive.google.com/file/d/${name}/view`, sha256: sha(c) })
const link = (fileUrl: string) => ({ fileUrl })
const seeded = (over: Row) => ({
  id: 'seed', contractNo: 'SD26Y-00099', drawingNo: 'GMDSPL-26110030', rev: 0, docType: 'GAD', product: null, pn: null, standard: null,
  flangeDrilling: null, preparedBy: null, remarks: null, itemCodes: [], status: 'Draft prepared', statusAt: new Date(NOW), statusBy: 'Puja',
  createdAt: new Date(NOW), updatedAt: new Date(NOW), ...over,
})
function reset(lines: Row[] = LINES) {
  Object.assign(db, { lines, drawings: [], events: [], queries: [], executed: [], ops: [], seq: 0, beforeWrite: null, answer: null })
}

test('an unknown or blank contract / PO no is not found and nothing is written', async () => {
  const s = await server()
  reset([])
  assert.equal(code(await s.getContractDrawings(tridip, 'NOPE-1')), 'not-found')
  assert.equal(code(await s.createDrawing(puja, { ...GAD, contract: 'NOPE-1' })), 'not-found')
  assert.equal(db.drawings.length, 0)
  db.queries.length = 0
  assert.equal(code(await s.getContractDrawings(tridip, '   ')), 'not-found')
  // An API body with a number where the contract no should be.
  assert.equal(code(await s.getContractDrawings(tridip, 42 as unknown as string)), 'not-found')
  assert.equal(db.queries.length, 0)
})

test('a contract is found by its contract no or PO no, with its header read from its lines', async () => {
  const s = await server()
  reset()
  const byNo = data(await s.getContractDrawings(tridip, ' sd26y-00067 '))
  assert.deepEqual(byNo.contract, {
    contractNo: 'SD26Y-00067', contractor: 'L&T Construction', client: 'PHED Rajasthan', project: 'Jal Jeevan Mission',
    poNo: 'PO 4500012345', contractDate: '05-Nov-2026', live: true,
    lines: [
      { itemCode: 'FTD040013', itemName: 'SLUICE VALVE', size: '100', pnRating: 'PN 10', orderQty: '4', approvalDate: null },
      { itemCode: 'FTD040017', itemName: 'SLUICE VALVE', size: '150', pnRating: 'PN 10', orderQty: '4', approvalDate: null },
    ],
  })
  assert.deepEqual(byNo.drawings, [])
  // The key is bound, normalised, never spliced into the SQL.
  const [lookup] = db.queries
  assert.ok(lookup.values.length > 0 && lookup.values.every((v) => v === 'SD26Y-00067'), JSON.stringify(lookup.values))
  assert.ok(!lookup.sql.includes('SD26Y'))

  assert.equal(data(await s.getContractDrawings(tridip, 'po  4500012345')).contract.contractNo, 'SD26Y-00067')
  // A PO split over two contracts names neither.
  db.lines = [...LINES, line('FTD050001', { contractNo: 'SD26Y-00068' })]
  assert.equal(code(await s.getContractDrawings(tridip, 'PO 4500012345')), 'invalid')
  // A contract whose every line has a STATUS is not live.
  db.lines = LINES.map((l) => ({ ...l, status: 'CLOSED' }))
  assert.equal(data(await s.getContractDrawings(tridip, 'SD26Y-00067')).contract.live, false)
})

test('a new entry starts as "Draft prepared", stamped; only a true repeat of the same create returns it', async () => {
  const s = await server()
  reset()
  const first = data(await s.createDrawing(claude, GAD))
  const { id, events, createdAt, updatedAt, ...fields } = first
  assert.deepEqual(fields, {
    contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', rev: 0, docType: 'GAD', product: 'Sluice valve DN100', pn: 'PN 10',
    standard: 'IS 14846', flangeDrilling: 'IS 1538', preparedBy: 'Claude', remarks: null, itemCodes: ['FTD040013'],
    status: 'Draft prepared', statusAt: NOW, statusBy: 'Claude (API)', moves: ['Sent to Washim for verification'],
  })
  assert.deepEqual(events.map((e) => [e.status, e.by, e.at, e.final]), [['Draft prepared', 'Claude (API)', NOW, false]])
  // One transaction: the number is locked before it is checked; the contract is locked before its sync.
  assert.deepEqual(db.ops, [
    'tx lock drawing-no:GMDSPL-26110030', 'tx read GMDSPL-26110030', 'tx create GMDSPL-26110030 R-0',
    'tx lock drawings:SD26Y-00067', 'tx sync SD26Y-00067',
  ])

  const again = data(await s.createDrawing(claude, { ...GAD, drawingNo: ' gmdspl-26110030 ', rev: 0 }))
  assert.equal(again.id, id)
  // Another document under the same number + rev on this contract is not a retry.
  const qap = await s.createDrawing(claude, { ...GAD, docType: 'QAP' })
  assert.ok(!qap.success && qap.code === 'conflict', JSON.stringify(qap))
  assert.equal(qap.suggestion, 'GMDSPL-26110031')
  assert.match(qap.error, /GMDSPL-26110030 R-0 is already this contract's GAD/)
  // The same number on this contract with another rev is a new revision, not a second entry.
  assert.equal(code(await s.createDrawing(claude, { ...GAD, rev: 1 })), 'invalid')
  assert.equal(db.drawings.length, 1)
  assert.equal(db.events.length, 1)
  // A line whose stored item code has a stray tab can still be tagged.
  assert.deepEqual(data(await s.createDrawing(puja, { ...GAD, drawingNo: 'GMDSPL-26110032', itemCodes: ['ftd040017'] })).itemCodes, ['FTD040017'])
})

test('a number another contract already uses is a conflict that offers the next free number', async () => {
  const s = await server()
  reset()
  db.drawings.push(seeded({ id: 'x1' }), seeded({ id: 'x2', drawingNo: 'GMDSPL-26110031' }), seeded({ id: 'x3', drawingNo: 'GMDSPL-26100077' }))
  const res = await s.createDrawing(puja, GAD)
  assert.ok(!res.success && res.code === 'conflict', JSON.stringify(res))
  assert.equal(res.suggestion, 'GMDSPL-26110032')
  assert.match(res.error, /SD26Y-00099/)
  assert.equal(db.drawings.length, 3)

  // Creates of one number queue on its lock and check only once they hold it, so a create that
  // committed while we waited is seen: ours becomes a conflict instead of a second owner.
  reset()
  once('lock', () => db.drawings.push(seeded({ id: 'race', rev: 1 })))
  assert.equal(code(await s.createDrawing(puja, GAD)), 'conflict')
  assert.deepEqual(db.drawings.map((d) => d.id), ['race'])
  assert.deepEqual(db.ops, ['tx lock drawing-no:GMDSPL-26110030', 'tx read GMDSPL-26110030'])
})

test('the next number suggestion continues this month across all contracts', async () => {
  const s = await server()
  reset()
  assert.equal(data(await s.suggestNextDrawingNo(washim)), 'GMDSPL-26110030')
  db.drawings.push(seeded({ id: 'x1', drawingNo: 'GMDSPL-26110035' }), seeded({ id: 'x2', drawingNo: 'GMDSPL-26100099', contractNo: 'SD26Y-00067' }))
  assert.equal(data(await s.suggestNextDrawingNo(claude)), 'GMDSPL-26110036')
})

test('a new revision supersedes the old one in the same transaction and keeps its files', async () => {
  const s = await server()
  reset()
  const r0 = data(await s.createDrawing(puja, GAD))
  data(await s.addFilesOrLinks(puja, r0.id, [pdf('gad-r0.pdf', 'a')]))
  db.ops.length = 0

  const r1 = data(await s.newRevision(puja, r0.id, 'Client asked for PN 16'))
  assert.deepEqual(
    [r1.drawingNo, r1.rev, r1.status, r1.docType, r1.product, r1.itemCodes, r1.preparedBy],
    ['GMDSPL-26110030', 1, 'Draft prepared', 'GAD', 'Sluice valve DN100', ['FTD040013'], 'Claude'],
  )
  assert.deepEqual(r1.events.map((e) => [e.status, e.comment, e.by]), [['Draft prepared', 'Client asked for PN 16', 'Puja']])
  assert.deepEqual(db.ops, [
    `tx update ${r0.id} Superseded`, 'tx events 1', 'tx create GMDSPL-26110030 R-1', 'tx lock drawings:SD26Y-00067', 'tx sync SD26Y-00067',
  ])

  const old = db.drawings.find((d) => d.id === r0.id)!
  assert.deepEqual([old.status, old.statusBy], ['Superseded', 'Puja'])
  assert.deepEqual(db.events.filter((e) => e.drawingId === r0.id).map((e) => e.status ?? e.fileName), ['Draft prepared', 'gad-r0.pdf', 'Superseded'])
  // A superseded revision is not revised again, and takes no new files.
  assert.equal(code(await s.newRevision(puja, r0.id)), 'not-allowed')
  assert.equal(code(await s.addFilesOrLinks(puja, r0.id, [pdf('late.pdf', 'c')])), 'not-allowed')
  assert.equal(db.drawings.length, 2)
})

test("a contract's drawings list newest revision first within each drawing no", async () => {
  const s = await server()
  reset()
  data(await s.createDrawing(puja, { ...GAD, drawingNo: 'GMDSPL-26110031', docType: 'QAP' }))
  const r0 = data(await s.createDrawing(puja, GAD))
  data(await s.newRevision(puja, r0.id))
  const got = data(await s.getContractDrawings(tridip, 'SD26Y-00067'))
  assert.deepEqual(got.drawings.map((x) => `${x.drawingNo} R-${x.rev} ${x.status}`), [
    'GMDSPL-26110030 R-1 Draft prepared',
    'GMDSPL-26110030 R-0 Superseded',
    'GMDSPL-26110031 R-0 Draft prepared',
  ])
})

test('a new revision someone else made meanwhile is reported as changed and nothing is written', async () => {
  const s = await server()
  reset()
  const r0 = data(await s.createDrawing(puja, GAD))
  // Their supersede commits between our read and our write.
  once('update', () => (db.drawings[0].status = 'Superseded'))
  assert.equal(code(await s.newRevision(washim, r0.id)), 'stale')
  assert.equal(db.drawings.length, 1)
  assert.deepEqual(db.events.map((e) => e.status), ['Draft prepared'])

  // Their rev + 1 already exists: the unique index refuses ours and the supersede is rolled back.
  reset()
  const r = data(await s.createDrawing(puja, GAD))
  db.drawings.push(seeded({ id: 'theirs', contractNo: 'SD26Y-00067', rev: 1 }))
  const before = JSON.stringify([db.drawings, db.events])
  assert.equal(code(await s.newRevision(washim, r.id)), 'stale')
  assert.equal(JSON.stringify([db.drawings, db.events]), before)
})

test('a status change applies only while the drawing still has the status the caller read', async () => {
  const s = await server()
  reset()
  const d = data(await s.createDrawing(puja, GAD))
  // The caller's screen is behind.
  assert.equal(code(await s.changeStatus(washim, d.id, { from: 'Sent to Washim for verification', to: 'Verified by Washim' })), 'stale')
  // The caller did not say what it saw: that is a bad request, not a stale screen.
  assert.equal(code(await s.changeStatus(puja, d.id, { from: ' ', to: 'Sent to Washim for verification' })), 'invalid')
  // The status moves between our read and our write.
  once('update', () => (db.drawings[0].status = 'Verified by Washim'))
  assert.equal(code(await s.changeStatus(puja, d.id, { from: 'Draft prepared', to: 'Sent to Washim for verification' })), 'stale')
  assert.deepEqual(db.events.map((e) => e.status), ['Draft prepared'])

  db.drawings[0].status = 'Draft prepared'
  const sent = data(await s.changeStatus(puja, d.id, { from: 'Draft prepared', to: 'Sent to Washim for verification', comment: ' please check ' }))
  assert.deepEqual([sent.status, sent.statusBy, sent.statusAt, sent.moves], ['Sent to Washim for verification', 'Puja', NOW, []])
  assert.deepEqual(sent.events.map((e) => [e.status, e.comment, e.by, e.at]), [
    ['Draft prepared', null, 'Puja', NOW],
    ['Sent to Washim for verification', 'please check', 'Puja', NOW],
  ])
  // Only the verifier answers it, and a correction needs its comment.
  assert.equal(code(await s.changeStatus(claude, d.id, { from: 'Sent to Washim for verification', to: 'Verified by Washim' })), 'not-allowed')
  assert.equal(code(await s.changeStatus(washim, d.id, { from: 'Sent to Washim for verification', to: 'Correction required' })), 'invalid')
  assert.equal(data(await s.changeStatus(washim, d.id, { from: 'Sent to Washim for verification', to: 'Correction required', comment: 'PN wrong' })).status, 'Correction required')
  assert.equal(code(await s.changeStatus(washim, 'no-such-id', { from: 'Draft prepared', to: 'Verified by Washim' })), 'not-found')
})

test('the approval-date sync runs after its per-contract lock, in the same transaction, on the shared "covered line" rule', async () => {
  const s = await server()
  reset()
  const d = data(await s.createDrawing(puja, GAD))
  db.drawings[0].status = 'Sent to client'
  db.ops.length = 0
  db.executed.length = 0
  data(await s.changeStatus(puja, d.id, { from: 'Sent to client', to: 'Approved by client', files: [pdf('approved.pdf', 'b')] }))
  // The lock comes before the UPDATE, so a sync that waited on another drawing of this contract
  // sees that drawing's committed status instead of an old snapshot.
  assert.deepEqual(db.ops, [`tx update ${d.id} Approved by client`, 'tx events 2', 'tx lock drawings:SD26Y-00067', 'tx sync SD26Y-00067'])
  assert.ok(db.executed.every((e) => e.inTx))
  const [lock, update] = db.executed.map(flat)
  assert.equal(lock.sql, 'SELECT pg_advisory_xact_lock(hashtext(?))')

  const rule = flat(s.coversLine('r')).sql
  assert.match(update.sql, /^UPDATE "ContractReview" AS c SET "approvalDate" = v\."day", "updatedAt" = now\(\) AT TIME ZONE 'UTC' FROM \(/)
  // Only lines some current drawing covers (an inner join on the shared rule), for this contract.
  assert.ok(update.sql.includes(`FROM "ContractReview" r JOIN "ContractDrawing" d ON ${rule} WHERE d."contractNo" = ? GROUP BY r.id`), update.sql)
  // The India day of the last approval once every covering drawing is approved, else blank.
  assert.match(update.sql, /CASE WHEN bool_and\(d\."status" = \?\) THEN to_char\(\(max\(d\."statusAt"\) AT TIME ZONE 'UTC'\) AT TIME ZONE 'Asia\/Kolkata', 'DD-Mon-YYYY'\) END AS "day"/)
  assert.match(update.sql, /WHERE c\.id = v\.id AND c\."approvalDate" IS DISTINCT FROM v\."day"$/)
  assert.deepEqual(update.values, ['Approved by client', 'Superseded', 'SD26Y-00067'])

  db.ops.length = 0
  data(await s.newRevision(puja, d.id))
  assert.deepEqual(db.ops.slice(-2), ['tx lock drawings:SD26Y-00067', 'tx sync SD26Y-00067'])
})

test('one "covered line" rule: a current drawing of the line\'s contract, untagged or tagging its item code; coveredLineIds asks it in one query', async () => {
  const s = await server()
  reset()
  const rule = flat(s.coversLine('r'))
  assert.match(rule.sql, /^d\."contractNo" = upper\(btrim\(regexp_replace\(coalesce\(r\."contractNo", ''\), '\[\[:space:\]\]\+', ' ', 'g'\)\)\)/)
  assert.match(rule.sql, / AND d\."status" <> \? AND /)
  assert.match(rule.sql, /\(cardinality\(d\."itemCodes"\) = 0 OR upper\(btrim\(regexp_replace\(coalesce\(r\."itemCode", ''\), '\[\[:space:\]\]\+', ' ', 'g'\)\)\) = ANY \(d\."itemCodes"\)\)$/)
  assert.deepEqual(rule.values, ['Superseded'])
  assert.match(flat(s.coversLine('c')).sql, /coalesce\(c\."contractNo", ''\)/)
  assert.throws(() => s.coversLine('r"; drop table x; --'))

  db.answer = () => [{ id: 'l1' }, { id: 'l3' }]
  assert.deepEqual(await s.coveredLineIds(['l1', 'l2', 'l3']), new Set(['l1', 'l3']))
  const [q] = db.queries.map(flat)
  assert.equal(q.sql, `SELECT DISTINCT r.id FROM "ContractReview" r JOIN "ContractDrawing" d ON ${rule.sql} WHERE r.id = ANY (?::text[])`)
  assert.deepEqual(q.values, ['Superseded', ['l1', 'l2', 'l3']])
  db.queries.length = 0
  assert.deepEqual(await s.coveredLineIds([]), new Set())
  assert.equal(db.queries.length, 0)
})

test('the same file bytes are recorded once per drawing; links are recorded as given', async () => {
  const s = await server()
  reset()
  const a = data(await s.createDrawing(puja, GAD))
  const b = data(await s.createDrawing(puja, { ...GAD, drawingNo: 'GMDSPL-26110031', docType: 'QAP' }))
  const folder = 'https://drive.google.com/drive/folders/abc'
  const got = data(await s.addFilesOrLinks(washim, a.id, [pdf('gad.pdf', 'a'), pdf('gad copy.pdf', 'A'), link(folder)]))
  assert.deepEqual(got.events.filter((e) => e.fileUrl).map((e) => [e.fileName ?? e.fileUrl, e.by, e.final]), [['gad.pdf', 'Washim', false], [folder, 'Washim', false]])
  data(await s.addFilesOrLinks(claude, a.id, [pdf('gad again.pdf', 'a')]))
  data(await s.addFilesOrLinks(claude, b.id, [pdf('gad.pdf', 'a')]))
  assert.deepEqual(db.events.filter((e) => e.sha256 === sha('a')).map((e) => e.drawingId), [a.id, b.id])
  assert.equal(code(await s.addFilesOrLinks(claude, 'no-such-id', [pdf('x.pdf', 'c')])), 'not-found')
})

test('the approving step needs a new PDF, and files attached then or while approved are FINAL', async () => {
  const s = await server()
  reset()
  const d = data(await s.createDrawing(puja, GAD))
  data(await s.addFilesOrLinks(puja, d.id, [pdf('sent.pdf', 'a')]))
  db.drawings[0].status = 'Client comments received'
  const approve = (files: { fileUrl: string }[]) =>
    s.changeStatus(claude, d.id, { from: 'Client comments received', to: 'Approved by client', comment: 'approved', files })
  // The copy the client already had: said plainly, not "needs a PDF".
  const again = await approve([pdf('sent again.pdf', 'a')])
  assert.ok(!again.success && again.code === 'invalid' && /already on this drawing/.test(again.error), JSON.stringify(again))
  // A link alone is not the approved copy.
  const linkOnly = await approve([link('https://drive.google.com/file/d/x/view')])
  assert.ok(!linkOnly.success && linkOnly.code === 'invalid' && /client-approved PDF/.test(linkOnly.error), JSON.stringify(linkOnly))
  // The same bytes land through another request mid-step: the approval is undone, never left without its FINAL copy.
  once('events', () => db.events.push({ id: 'theirs', drawingId: d.id, status: null, comment: null, fileName: 'theirs.pdf', fileUrl: 'https://x/y', sha256: sha('b'), final: false, by: 'Puja', at: new Date(NOW) }))
  assert.equal(code(await approve([pdf('approved.pdf', 'b')])), 'stale')
  assert.equal(db.drawings[0].status, 'Client comments received')

  assert.equal(data(await approve([pdf('approved.pdf', 'b')])).status, 'Approved by client')
  data(await s.addFilesOrLinks(puja, d.id, [pdf('approved signed.pdf', 'c')]))
  assert.deepEqual(db.events.filter((e) => e.fileName).map((e) => [e.fileName, e.final]), [
    ['sent.pdf', false],
    ['approved.pdf', true],
    ['approved signed.pdf', true],
  ])
})

test('a viewer reads a contract and its drawings but can change nothing', async () => {
  const s = await server()
  reset()
  const d = data(await s.createDrawing(puja, GAD))
  const before = JSON.stringify([db.drawings, db.events])
  const tries = [
    await s.createDrawing(tridip, { ...GAD, drawingNo: 'GMDSPL-26110031' }),
    await s.addFilesOrLinks(tridip, d.id, [pdf('x.pdf', 'a')]),
    await s.changeStatus(tridip, d.id, { from: 'Draft prepared', to: 'Sent to Washim for verification' }),
    await s.newRevision(tridip, d.id),
    await s.suggestNextDrawingNo(tridip),
  ]
  assert.deepEqual(tries.map(code), Array(5).fill('not-allowed'))
  assert.equal(JSON.stringify([db.drawings, db.events]), before)
  const seen = data(await s.getContractDrawings(tridip, 'SD26Y-00067'))
  assert.deepEqual(seen.drawings.map((x) => [x.drawingNo, x.moves]), [['GMDSPL-26110030', []]])
})

test('bad input is refused before anything is written', async () => {
  const s = await server()
  reset()
  for (const input of [
    { ...GAD, drawingNo: 'GMDSPL-2611030' },
    { ...GAD, drawingNo: 'GMD-26110030' },
    { ...GAD, drawingNo: 'GMDSPL-26130001' },
    { ...GAD, docType: 'Drawing' },
    { ...GAD, rev: -1 },
    { ...GAD, rev: 1.5 },
    { ...GAD, itemCodes: ['FTD040013', 'FTD999999'] },
    // One code sent as a plain string would otherwise tag nothing, i.e. the whole contract.
    { ...GAD, itemCodes: 'FTD040013' as unknown as string[] },
  ]) {
    assert.equal(code(await s.createDrawing(puja, input)), 'invalid', JSON.stringify(input))
  }
  assert.equal(db.drawings.length, 0)
  const d = data(await s.createDrawing(puja, GAD))
  for (const files of [[link('javascript:alert(1)')], [link('not a link')], [{ ...pdf('x.pdf', 'a'), sha256: 'abc' }], [], 'https://x/y.pdf' as unknown as []]) {
    assert.equal(code(await s.addFilesOrLinks(puja, d.id, files)), 'invalid', JSON.stringify(files))
  }
  assert.equal(code(await s.changeStatus(puja, d.id, { from: 'Draft prepared', to: 'Sent to Washim for verification', files: [link('ftp://x/y.pdf')] })), 'invalid')
  assert.deepEqual(db.events.map((e) => e.status), ['Draft prepared'])
})

test('an unexpected database failure is logged, and the caller gets no SQL or table names', async () => {
  const s = await server()
  reset()
  db.answer = () => {
    throw new Error('relation "ContractReview" does not exist')
  }
  const logged = mock.method(console, 'error', () => {})
  try {
    const res = await s.getContractDrawings(tridip, 'SD26Y-00067')
    assert.ok(!res.success && res.code === 'error' && !/relation|ContractReview/.test(res.error), JSON.stringify(res))
    assert.equal(logged.mock.callCount(), 1)
  } finally {
    logged.mock.restore()
  }
})

// ---- The Drawings page, in SQL -------------------------------------------------------------

const base = { page: 1, pageSize: 50, sort: null, search: '', filters: {} }

test('the page lists current drawings plus one "No drawings" row per live contract, with days at stage in India days', async () => {
  const s = await server()
  reset()
  db.answer = (q) => (/count\(\*\)/.test(q.sql) ? [{ total: 3 }] : [{ id: 'd1' }, { id: 'contract:SD26Y-00068' }])
  assert.deepEqual(await s.listDrawingsPage(base), { rows: [{ id: 'd1' }, { id: 'contract:SD26Y-00068' }], total: 3 })
  const [rows, count] = db.queries.map(flat)
  assert.match(rows.sql, /FROM "ContractDrawing" d LEFT JOIN c ON c\."contractNo" = d\."contractNo" WHERE d\."status" <> \?/)
  assert.match(rows.sql, /UNION ALL SELECT 'contract:' \|\| c\."contractNo"/)
  assert.match(rows.sql, /WHERE c\."live" AND c\."contractNo" <> '' AND NOT EXISTS \(SELECT 1 FROM "ContractDrawing" x WHERE x\."contractNo" = c\."contractNo"\)/)
  assert.ok(rows.sql.includes(`(now() AT TIME ZONE 'Asia/Kolkata')::date - ((d."statusAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS "daysAtStage"`))
  // The header values are the same pick the contract section makes: the first filled one in item-code order.
  assert.ok(rows.sql.includes(`coalesce((array_agg(nullif(btrim(r."partyNameDump"), '') ORDER BY r."itemCode", r.id) FILTER (WHERE nullif(btrim(r."partyNameDump"), '') IS NOT NULL))[1], '') AS "contractor"`))
  assert.ok(rows.values.includes('Superseded') && rows.values.includes('No drawings'))
  assert.match(count.sql, /SELECT count\(\*\)::int AS total FROM f$/)
})

test('pending mode leaves out contracts without drawings and drawings the client approved', async () => {
  const s = await server()
  reset()
  db.answer = (q) => (/count\(\*\)/.test(q.sql) ? [{ total: 0 }] : [])
  await s.listDrawingsPage({ ...base, extra: { pending: true } })
  for (const q of db.queries.map(flat)) {
    assert.match(q.sql, /l\."status" NOT IN \(\?, \?\)/)
    assert.ok(q.values.includes('No drawings') && q.values.includes('Approved by client'))
  }
  db.queries.length = 0
  await s.listDrawingsPage(base)
  assert.ok(db.queries.length === 2 && db.queries.every((q) => !q.sql.includes('NOT IN')))
})

test('a facet lists values under the other filters and ignores its own selection', async () => {
  const s = await server()
  reset()
  db.answer = () => [{ v: '' }, { v: 'PHED Rajasthan' }]
  const query = { ...base, filters: { client: ['PHED Rajasthan'], status: ['Sent to client'] }, extra: { pending: true } }
  assert.deepEqual(await s.listDrawingsFacet('client', query), ['(Blank)', 'PHED Rajasthan'])
  const q = flat(db.queries[0])
  assert.match(q.sql, /l\."status" = \?/)
  assert.match(q.sql, /l\."status" NOT IN \(\?, \?\)/)
  assert.ok(!q.sql.includes('l."client" = '))
  assert.ok(q.values.includes('Sent to client') && !q.values.includes('PHED Rajasthan'))
  // Status options come in flow order, not alphabetically.
  db.queries.length = 0
  await s.listDrawingsFacet('status', base)
  assert.match(flat(db.queries[0]).sql, /GROUP BY 1 ORDER BY array_position\(\?::text\[\], l\."status"\)/)
  // Not a facet column: nothing is asked of the DB.
  db.queries.length = 0
  assert.deepEqual(await s.listDrawingsFacet('product', base), [])
  assert.deepEqual(await s.listDrawingsFacet('x"; drop table', base), [])
  assert.equal(db.queries.length, 0)
})

test('unknown filter and sort keys are dropped, status sorts in flow order and the page size is capped', async () => {
  const s = await server()
  reset()
  db.answer = (q) => (/count\(\*\)/.test(q.sql) ? [{ total: 0 }] : [])
  await s.listDrawingsPage({ ...base, page: 2, pageSize: 5000, filters: { bogus: ['x'], product: ['y'], owner: ['Claude'] }, sort: { key: 'x"; drop', dir: 'asc' } })
  const rows = flat(db.queries[0])
  assert.ok(!rows.sql.includes('bogus') && !rows.sql.includes('drop') && !rows.values.includes('x') && !rows.values.includes('y'))
  assert.match(rows.sql, /l\."owner" = \?/)
  assert.match(rows.sql, /ORDER BY f\."contractNo", f\."drawingNo", f\.id LIMIT \? OFFSET \?$/)
  assert.deepEqual(rows.values.slice(-2), [200, 200])

  db.queries.length = 0
  await s.listDrawingsPage({ ...base, sort: { key: 'status', dir: 'desc' } })
  const sorted = flat(db.queries[0])
  assert.match(sorted.sql, /ORDER BY array_position\(\?::text\[\], f\."status"\) DESC, f\."contractNo"/)
  assert.ok(sorted.values.some((v) => JSON.stringify(v) === JSON.stringify([
    'No drawings', 'Draft prepared', 'Sent to Washim for verification', 'Correction required', 'Verified by Washim',
    'Sent to client', 'Client comments received', 'Approved by client', 'Superseded',
  ])))
})
