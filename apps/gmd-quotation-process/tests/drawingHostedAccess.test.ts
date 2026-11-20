import test from 'node:test'
import assert from 'node:assert/strict'
import './fake-gdrive.mjs'
import { host } from './fake-drawings-host.mjs'
import { hostedPageAllowed, requireDrawingsAccess } from '../lib/access.js'

// The Drawings guard on the hosted site (VERCEL set): any signed-in user reads, the drawings rights model decides writes.
;(globalThis as unknown as { tenderPrisma: unknown }).tenderPrisma = { contractDrawing: { findUnique: async () => null } }
process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'

const USER = { user: { email: 'tridip@gmd.example', role: 'user' } }
const VERIFIER = { user: { email: 'washim@gmd.example', role: 'user' } }
const ADMIN = { user: { email: 'puja@gmd.example', role: 'admin' } }
const STEP = { from: 'Draft prepared', to: 'Sent to Washim for verification' }
const INPUT = { contract: 'C1', drawingNo: 'GMDSPL-26110030', docType: 'GA Drawing' } as never

function as(session: typeof host.session, hosted: boolean) {
  Object.assign(host, { session, verifiers: ['washim@gmd.example'], calls: [], revalidated: [], answers: {} })
  if (hosted) process.env.VERCEL = '1'
  else delete process.env.VERCEL
}
test.afterEach(() => { delete process.env.VERCEL })

test('the guard: hosted refuses signed-out, admits any signed-in role; LAN is open', async () => {
  as(null, true)
  await assert.rejects(requireDrawingsAccess(), /Unauthorized/)
  as(USER, true)
  await requireDrawingsAccess()
  as(null, false)
  await requireDrawingsAccess()
})

test('hosted page gate: any signed-in user on /drawings only; admin and developer anywhere; signed out nowhere', () => {
  assert.equal(hostedPageAllowed('/drawings', { role: 'user' }), true)
  assert.equal(hostedPageAllowed('/contract_review', { role: 'user' }), false)
  assert.equal(hostedPageAllowed('/drawings/x', { role: 'user' }), false)
  assert.equal(hostedPageAllowed('/drawings', null), false)
  assert.equal(hostedPageAllowed('/contract_review', { role: 'admin' }), true)
  assert.equal(hostedPageAllowed('/bom', { role: 'developer' }), true)
})

test('hosted: signed-out is refused every drawings action', async () => {
  const a = await import('../app/drawings/actions.js')
  as(null, true)
  for (const res of [await a.loadPage({} as never), await a.loadFacet('status', {} as never), await a.loadContractDrawings('C1'), await a.suggestDrawingNo(), await a.getDrawingRights()]) {
    assert.equal(res.success, false)
  }
  for (const res of [await a.createDrawingEntry(INPUT), await a.attachDrawingFiles('d1', [], ['https://x.test/a']), await a.changeDrawingStatus('d1', STEP), await a.newDrawingRevision('d1')]) {
    assert.equal(res.success, false)
  }
  assert.deepEqual(host.calls, [])
})

test('hosted: a role "user" reads, sees no Contract Review lines, and is refused every write', async () => {
  const a = await import('../app/drawings/actions.js')
  as(USER, true)
  assert.equal((await a.loadPage({} as never)).success, true)
  assert.equal((await a.loadFacet('status', {} as never)).success, true)
  assert.deepEqual(await a.getDrawingRights(), { success: true, data: { role: 'viewer' } })
  host.answers.getContractDrawings = { success: true, data: { contract: { contractNo: 'C1', lines: [{ itemCode: 'X', itemName: 'Valve' }] }, drawings: [] } }
  const res = await a.loadContractDrawings('C1')
  assert.deepEqual(res.success && res.data.contract.lines, [])
  host.calls.length = 0
  for (const w of [await a.createDrawingEntry(INPUT), await a.attachDrawingFiles('d1', [], ['https://x.test/a']), await a.changeDrawingStatus('d1', STEP), await a.newDrawingRevision('d1')]) {
    assert.equal(w.success, false)
    assert.equal('code' in w && w.code, 'not-allowed')
  }
  assert.deepEqual(host.calls, [])
  assert.deepEqual(host.revalidated, [])
})

test('hosted: a verifier with role "user" writes (and sees the lines to tag); admin is an editor', async () => {
  const a = await import('../app/drawings/actions.js')
  as(VERIFIER, true)
  assert.equal((await a.changeDrawingStatus('d1', STEP)).success, true)
  assert.equal((await a.createDrawingEntry(INPUT)).success, true)
  host.answers.getContractDrawings = { success: true, data: { contract: { lines: [{ itemCode: 'X' }] }, drawings: [] } }
  const res = await a.loadContractDrawings('C1')
  assert.equal(res.success && res.data.contract.lines.length, 1)
  assert.deepEqual(host.calls.map((c) => [c[0], (c[1] as { role: string }).role]), [['changeStatus', 'verifier'], ['createDrawing', 'verifier'], ['getContractDrawings', 'verifier']])

  as(ADMIN, true)
  assert.deepEqual(await a.getDrawingRights(), { success: true, data: { role: 'editor' } })
  assert.equal((await a.newDrawingRevision('d1')).success, true)
  assert.equal((host.calls[0][1] as { role: string }).role, 'editor')
})

test('LAN: reading is open; every write still needs a sign-in', async () => {
  const a = await import('../app/drawings/actions.js')
  as(null, false)
  assert.equal((await a.loadPage({} as never)).success, true)
  assert.equal((await a.createDrawingEntry(INPUT)).success, false)
  assert.equal((await a.newDrawingRevision('d1')).success, false)
  assert.equal((await a.changeDrawingStatus('d1', STEP)).success, false)
  assert.equal((await a.attachDrawingFiles('d1', [], ['https://x.test/a'])).success, false)
})
