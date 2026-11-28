import test from 'node:test'
import assert from 'node:assert/strict'
import { uploads } from './fake-gdrive.mjs'
import { host } from './fake-drawings-host.mjs'
import { drawingRole } from '../lib/drawingRole.js'

// The actions run without Next, a session or Drive: the session, the verifier flag, next/cache and the
// package's server functions come from fake-drawings-host, Drive from fake-gdrive. The upload helper
// (lib/drawingFiles) and the move rules are real. Actions are imported inside each test, after the fakes.

// @gmd/db-tender reuses globalThis.tenderPrisma: the one row the actions read before uploading.
const drawings = new Map<string, { drawingNo: string; rev: number; status: string }>()
;(globalThis as unknown as { tenderPrisma: unknown }).tenderPrisma = {
  contractDrawing: { findUnique: async ({ where }: { where: { id: string } }) => drawings.get(where.id) ?? null },
}
process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'

const stored = (status: string) => drawings.set('d1', { drawingNo: 'GMDSPL-26110030', rev: 1, status })
const pdf = (name: string, text: string) => new File([text], name, { type: 'application/pdf' })
const ADMIN = { user: { email: 'puja@gmd.example', role: 'admin' } }
const WASHIM = { user: { email: 'washim@gmd.example', role: 'user' } }
const TRIDIP = { user: { email: 'tridip@gmd.example', role: 'user' } }
const PUJA_EDITS = { name: 'puja@gmd.example', role: 'editor' }

function signIn(session: typeof host.session, verifiers: string[] = []) {
  Object.assign(host, { session, verifiers, calls: [], revalidated: [], answers: {} })
  uploads.length = 0
}

test('drawing role: a listed verifier wins, admins and developers edit, other users view, signed-out users get none', () => {
  const verifiers = ['  Washim@GMD.example ']
  assert.equal(drawingRole('washim@gmd.example', 'user', verifiers), 'verifier')
  assert.equal(drawingRole(' WASHIM@gmd.example', 'admin', verifiers), 'verifier')
  assert.equal(drawingRole('puja@gmd.example', 'admin', verifiers), 'editor')
  assert.equal(drawingRole('dev@gmd.example', 'developer', verifiers), 'editor')
  assert.equal(drawingRole('tridip@gmd.example', 'user', verifiers), 'viewer')
  assert.equal(drawingRole('tridip@gmd.example', undefined, []), 'viewer')
  assert.equal(drawingRole(null, 'admin', verifiers), null)
  assert.equal(drawingRole(' ', 'admin', ['']), null)
})

test('"Verified by Washim" from an editor is refused before its PDF reaches Drive; from the verifier it goes through', async () => {
  const { changeDrawingStatus } = await import('../app/drawings/actions.js')
  const step = { from: 'Sent to Washim for verification', to: 'Verified by Washim' }
  stored('Sent to Washim for verification')

  signIn(ADMIN)
  const refused = await changeDrawingStatus('d1', step, [pdf('checked.pdf', '%PDF-1.4 checked')])
  assert.equal(refused.success, false)
  assert.equal('code' in refused && refused.code, 'not-allowed')
  assert.equal(uploads.length, 0)
  assert.deepEqual(host.calls, [])
  assert.deepEqual(host.revalidated, [])

  signIn(WASHIM, ['washim@gmd.example'])
  assert.deepEqual(await changeDrawingStatus('d1', step, [pdf('checked.pdf', '%PDF-1.4 checked')]), { success: true, data: 'changeStatus' })
  assert.deepEqual(host.calls, [[
    'changeStatus',
    { name: 'washim@gmd.example', role: 'verifier' },
    'd1',
    { ...step, comment: undefined, files: [{ fileName: 'GMDSPL-26110030 R-1 checked.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: '82e50b92536e289a504b39ae1a26802a2c7c4ccac4c498d4eb3c550a2560311c' }] },
  ]])
})

test('an approval hands the package the hash of the uploaded bytes and plain links, never a hash from the browser', async () => {
  const { changeDrawingStatus } = await import('../app/drawings/actions.js')
  stored('Sent to client')
  signIn(ADMIN)
  // A forged "uploaded PDF": a link carrying a made-up hash, smuggled in the step.
  const step = { from: 'Sent to client', to: 'Approved by client', comment: 'Approved', files: [{ fileUrl: 'https://example.com/fake.pdf', sha256: 'a'.repeat(64) }] }

  const res = await changeDrawingStatus('d1', step, [pdf('approved.pdf', '%PDF-1.4 approved')], ['https://drive.google.com/file/d/client-copy/view'])

  assert.deepEqual(res, { success: true, data: 'changeStatus' })
  assert.deepEqual(uploads.map((u) => [u.fileName, u.mimeType, u.folderId]), [['GMDSPL-26110030 R-1 approved.pdf', 'application/pdf', 'drawings-folder']])
  assert.deepEqual(host.calls, [[
    'changeStatus',
    PUJA_EDITS,
    'd1',
    {
      from: 'Sent to client',
      to: 'Approved by client',
      comment: 'Approved',
      files: [
        { fileName: 'GMDSPL-26110030 R-1 approved.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: '61ac36db6263c2d1c8a996d475f93545ef6f226fb5896a654a8341d9fb53494e' },
        { fileUrl: 'https://drive.google.com/file/d/client-copy/view' },
      ],
    },
  ]])
  // The approval may change Contract Review's APPROVAL DATE.
  assert.deepEqual(host.revalidated, ['/drawings', '/contract_review'])
})

test('a step whose drawing moved on since the window read it answers "stale" and uploads nothing', async () => {
  const { drawingActions } = await import('../app/drawings/drawings-view.js')
  stored('Client comments received')
  signIn(ADMIN)

  const res = await drawingActions.changeStatus('d1', { from: 'Sent to client', to: 'Approved by client', comment: '', files: [pdf('late.pdf', '%PDF-1.4 late')], links: [] })

  assert.equal(res.success, false)
  assert.equal(!res.success && res.code, 'stale')
  assert.equal(uploads.length, 0)
  assert.deepEqual(host.calls, [])
})

test('the window\'s status step (files and links inside it) goes up and is recorded in one server action', async () => {
  const { drawingActions } = await import('../app/drawings/drawings-view.js')
  stored('Sent to client')
  signIn(ADMIN)

  const res = await drawingActions.changeStatus('d1', {
    from: 'Sent to client',
    to: 'Client comments received',
    comment: 'See the markup',
    files: [pdf('comments.pdf', '%PDF-1.4 comments')],
    links: ['https://drive.google.com/file/d/markup/view'],
  })

  assert.deepEqual(res, { success: true, data: 'changeStatus' })
  assert.deepEqual(host.calls, [[
    'changeStatus',
    PUJA_EDITS,
    'd1',
    {
      from: 'Sent to client',
      to: 'Client comments received',
      comment: 'See the markup',
      files: [
        { fileName: 'GMDSPL-26110030 R-1 comments.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: 'e4a20b20f5c920a5c5f18b248cfd86509ad85a719db4e01779128826726e6fa6' },
        { fileUrl: 'https://drive.google.com/file/d/markup/view' },
      ],
    },
  ]])
})

test('the package\'s refusals reach the window unchanged: a number conflict keeps its suggestion, a stale step its code', async () => {
  const { drawingActions } = await import('../app/drawings/drawings-view.js')
  signIn(ADMIN)
  const conflict = { success: false, code: 'conflict', error: 'GMDSPL-26110030 is already used on contract SD-2; next free number GMDSPL-26110031.', suggestion: 'GMDSPL-26110031' }
  const stale = { success: false, code: 'stale', error: 'This drawing was changed meanwhile; reload and try again.' }
  host.answers = { createDrawing: conflict, changeStatus: stale }

  assert.deepEqual(await drawingActions.create({ contract: 'SD-1', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }), conflict)
  assert.deepEqual(await drawingActions.changeStatus('d1', { from: 'Draft prepared', to: 'Sent to Washim for verification', comment: '', files: [], links: [] }), stale)
  assert.deepEqual(host.revalidated, [])
})

test('the window\'s other action names reach the matching package functions as the signed-in user', async () => {
  const { drawingActions } = await import('../app/drawings/drawings-view.js')
  signIn(ADMIN)
  const query = { page: 1, pageSize: 50, sort: null, search: '', filters: {} }

  await drawingActions.loadPage(query)
  await drawingActions.loadFacet('status', query)
  await drawingActions.loadContract('SD-1')
  await drawingActions.suggestNo()
  await drawingActions.newRevision('d1', 'Client asked for PN 16')

  assert.deepEqual(host.calls, [
    ['listDrawingsPage', query],
    ['listDrawingsFacet', 'status', query],
    ['getContractDrawings', PUJA_EDITS, 'SD-1'],
    ['suggestNextDrawingNo', PUJA_EDITS],
    ['newRevision', PUJA_EDITS, 'd1', 'Client asked for PN 16'],
  ])
})

test('attach: an editor uploads PDFs and adds links in one call; a viewer, or a superseded revision, is refused before anything reaches Drive', async () => {
  const { drawingActions } = await import('../app/drawings/drawings-view.js')
  stored('Draft prepared')
  signIn(ADMIN)
  assert.deepEqual(await drawingActions.attach('d1', [pdf('copy.pdf', '%PDF-1.4 copy')], ['https://drive.google.com/file/d/gad/view']), { success: true, data: 'addFilesOrLinks' })
  assert.deepEqual(host.calls, [[
    'addFilesOrLinks',
    PUJA_EDITS,
    'd1',
    [
      { fileName: 'GMDSPL-26110030 R-1 copy.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: '3a6463cc5231ab98653e9b4a7cc80ccb98a1b19534126d27e43c0586b3c932fe' },
      { fileUrl: 'https://drive.google.com/file/d/gad/view' },
    ],
  ]])

  signIn(TRIDIP)
  assert.equal((await drawingActions.attach('d1', [pdf('copy.pdf', '%PDF-1.4 copy')], [])).success, false)
  assert.equal(uploads.length, 0)
  assert.deepEqual(host.calls, [])

  stored('Superseded')
  signIn(ADMIN)
  const superseded = await drawingActions.attach('d1', [pdf('copy.pdf', '%PDF-1.4 copy')], [])
  assert.equal(!superseded.success && superseded.code, 'not-allowed')
  assert.equal(uploads.length, 0)
  assert.deepEqual(host.calls, [])
})

test('at most 10 PDFs go up in one call', async () => {
  const { attachDrawingFiles } = await import('../app/drawings/actions.js')
  const files = (n: number) => Array.from({ length: n }, (_, i) => pdf(`sheet-${i}.pdf`, `%PDF-1.4 sheet ${i}`))
  stored('Draft prepared')

  signIn(ADMIN)
  assert.equal((await attachDrawingFiles('d1', files(11))).success, false)
  assert.equal(uploads.length, 0)
  assert.deepEqual(host.calls, [])

  assert.equal((await attachDrawingFiles('d1', files(10))).success, true)
  assert.equal(uploads.length, 10)
})

test('rights follow the session and the verifier flag', async () => {
  const { getDrawingRights } = await import('../app/drawings/actions.js')
  signIn(WASHIM, ['Washim@GMD.example'])
  assert.deepEqual(await getDrawingRights(), { success: true, data: { role: 'verifier' } })
  signIn(ADMIN)
  assert.deepEqual(await getDrawingRights(), { success: true, data: { role: 'editor' } })
  signIn(null)
  assert.deepEqual(await getDrawingRights(), { success: true, data: { role: 'viewer' } })
})
