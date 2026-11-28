import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import nodeModule from 'node:module'
import { hooks, uploads } from './fake-gdrive.mjs'

// The drawings API route runs against fakes, so nothing reaches a database or Drive:
// - @gmd/drawings/server resolves to a module handing each call to `answers` (recorded in `calls`);
// - the tender DB (globalThis.tenderPrisma) only serves the route's drawing lookup, from `rows`;
// - lib/gdrive is fake-gdrive (`uploads`).
const calls: unknown[][] = []
const answers: Record<string, unknown> = {}
const rows = new Map<string, { id: string; contractNo: string; status: string }>()
let dbFails = false
const g = globalThis as unknown as Record<string, unknown>
g.drawingsFake = new Proxy({}, {
  get: (_, name: string) => async (...args: unknown[]) => {
    calls.push([name, ...args])
    const answer = answers[name]
    return typeof answer === 'function' ? answer(...args) : answer
  },
})
g.tenderPrisma = {
  contractDrawing: {
    findUnique: async ({ where }: { where: { drawingNo_rev: { drawingNo: string; rev: number } } }) => {
      calls.push(['db', where.drawingNo_rev])
      if (dbFails) throw new Error('connection refused: secret-host')
      return rows.get(`${where.drawingNo_rev.drawingNo} R-${where.drawingNo_rev.rev}`) ?? null
    },
  },
}
const SERVER = ['getContractDrawings', 'suggestNextDrawingNo', 'createDrawing', 'addFilesOrLinks', 'changeStatus']
const FAKE_SERVER = 'data:text/javascript,fake-drawings-server'
type Next = (target: string, context: unknown) => unknown
// registerHooks (Node >= 22.15) is newer than the repo's @types/node 20.
;(nodeModule as unknown as { registerHooks(hooks: object): void }).registerHooks({
  resolve: (specifier: string, context: unknown, next: Next) =>
    specifier === '@gmd/drawings/server' ? { url: FAKE_SERVER, shortCircuit: true } : next(specifier, context),
  // Served here: tsx's loader would read a data: URL as a file path.
  load: (url: string, context: unknown, next: Next) =>
    url === FAKE_SERVER
      ? { format: 'module', shortCircuit: true, source: SERVER.map((n) => `export const ${n} = (...a) => globalThis.drawingsFake.${n}(...a);`).join('\n') }
      : next(url, context),
})

process.env.GMD_DRAWINGS_API_KEY = 'drawings-key'
process.env.GMD_SYNC_API_KEY = 'sync-key'
process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'

const route = () => import('../app/api/drawings/route.js')
const ACTOR = { name: 'Claude (API)', role: 'api' }
const BASE = 'http://localhost/api/drawings'
const KEY = { 'x-api-key': 'drawings-key' }
const PDF = '%PDF-1.7\n1 0 obj\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const pdf = (name = 'drawing.pdf', body = PDF) => new File([body], name, { type: 'application/pdf' })
// The route refuses a body that does not declare its length, so every test request does.
const post = (body: unknown, headers: Record<string, string> = KEY) => {
  const json = JSON.stringify(body)
  return new Request(BASE, { method: 'POST', headers: { 'content-length': String(Buffer.byteLength(json)), ...headers }, body: json })
}
type Fields = [string, string | File][]
const patch = async (fields: Fields, headers: Record<string, string> = KEY) => {
  const form = new FormData()
  for (const [k, v] of fields) form.append(k, v)
  const encoded = new Response(form)
  const body = await encoded.arrayBuffer()
  return new Request(BASE, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.byteLength) },
    body,
  })
}
const NO: Fields = [['drawingNo', 'GMDSPL-26110030'], ['rev', '0']]
const step = async (status: string, ...more: Fields) => patch([...NO, ['status', status], ...more])
const onDrawing = (status: string) => rows.set('GMDSPL-26110030 R-0', { id: 'd1', contractNo: 'SD26Y-00067', status })
const entry = (more: object = {}) => ({
  id: 'd1', contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', rev: 0, docType: 'GAD',
  status: 'Draft prepared', statusAt: '2026-11-18T06:00:00.000Z', statusBy: 'Claude (API)', events: [], moves: [], ...more,
})
// A function, so the narrowing of `calls` by an earlier assert.deepEqual(calls, []) does not carry in.
const callNames = () => calls.map(([n]) => n)
const reset = () => {
  calls.length = 0
  uploads.length = 0
  rows.clear()
  dbFails = false
  hooks.duringUpload = null
  for (const k of Object.keys(answers)) delete answers[k]
}

test('requireSyncApiKey with the drawings key: 503 when unset or copied from the sync key, 401 for the sync key; the default still takes only the sync key', async () => {
  const { requireSyncApiKey } = await import('../schedular_function/auth.js')
  const D = 'GMD_DRAWINGS_API_KEY'
  const status = (key: string | null, env?: 'GMD_DRAWINGS_API_KEY') => {
    const res = requireSyncApiKey(new Request(BASE, { headers: key ? { 'x-api-key': key } : {} }), env)
    return res.ok ? 'ok' : res.status
  }
  try {
    delete process.env[D]
    assert.equal(status('drawings-key', D), 503)
    process.env[D] = 'drawings-key'
    assert.deepEqual([status('drawings-key', D), status('sync-key', D), status(null, D)], ['ok', 401, 401])
    assert.deepEqual([status('sync-key'), status('drawings-key'), status(null)], ['ok', 401, 401])
    // A drawings key equal to the sync key would also start every scheduler job (client reminder mails included).
    process.env[D] = 'sync-key'
    assert.equal(status('sync-key', D), 503)
    assert.equal(status('sync-key'), 'ok')
    delete process.env.GMD_SYNC_API_KEY
    assert.equal(status('sync-key'), 503)
  } finally {
    process.env[D] = 'drawings-key'
    process.env.GMD_SYNC_API_KEY = 'sync-key'
  }
})

test('every method answers 401 to a missing key or the sync key, before any other work', async () => {
  const { GET, POST, PATCH } = await route()
  reset()
  for (const headers of [{}, { 'x-api-key': 'sync-key' }] as Record<string, string>[]) {
    const res = [
      await GET(new Request(`${BASE}?contractNo=SD26Y-00067`, { headers })),
      await POST(post({ contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }, headers)),
      await PATCH(await patch([...NO, ['status', 'Sent to client'], ['file', pdf()]], headers)),
    ]
    assert.deepEqual(res.map((r) => r.status), [401, 401, 401])
    assert.deepEqual(await res[1].json(), { error: 'Invalid or missing x-api-key.' })
  }
  assert.deepEqual(calls, [])
  assert.equal(uploads.length, 0)
})

test('GET needs contractNo or poNo (400), then returns the next number, the contract header and its entries', async () => {
  const { GET } = await route()
  reset()
  for (const query of ['', '?contractNo=%20', '?drawingNo=GMDSPL-26110030']) {
    assert.equal((await GET(new Request(`${BASE}${query}`, { headers: KEY }))).status, 400, query)
  }
  assert.deepEqual(calls, [])

  const contract = { contractNo: 'SD26Y-00067', contractor: 'LCC Projects Ltd', client: null, project: null, poNo: '42009843', contractDate: '18.11.2026', live: true, lines: [] }
  answers.getContractDrawings = { success: true, data: { contract, drawings: [entry()] } }
  answers.suggestNextDrawingNo = { success: true, data: 'GMDSPL-26110031' }
  const res = await GET(new Request(`${BASE}?poNo=42009843`, { headers: KEY }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { nextDrawingNo: 'GMDSPL-26110031', contract, entries: [entry()] })
  assert.deepEqual(calls, [['getContractDrawings', ACTOR, '42009843'], ['suggestNextDrawingNo', ACTOR]])

  answers.getContractDrawings = { success: false, code: 'not-found', error: 'No contract or PO "X" in Contract Review.' }
  const missing = await GET(new Request(`${BASE}?contractNo=X`, { headers: KEY }))
  assert.deepEqual([missing.status, await missing.json()], [404, { error: 'No contract or PO "X" in Contract Review.' }])
})

test('POST refuses invalid input with 400 naming the field, before any package call', async () => {
  const { POST } = await route()
  reset()
  const good = { contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }
  const cases: [unknown, string][] = [
    [{ ...good, docType: 'Drawing' }, 'docType'],
    [{ ...good, drawingNo: 'GMD-26110030' }, 'drawingNo'],
    [{ ...good, drawingNo: 'GMDSPL-26130001' }, 'drawingNo'],
    [{ ...good, rev: -1 }, 'rev'],
    [{ ...good, rev: 1.5 }, 'rev'],
    [{ ...good, rev: '1' }, 'rev'],
    [{ ...good, contractNo: '  ' }, 'contractNo'],
    [{ ...good, pn: 16 }, 'pn'],
    [{ ...good, itemCodes: 'FTD040017' }, 'itemCodes'],
    // No file can come with a POST, and a hash is only ever computed from uploaded bytes.
    [{ ...good, sha256: 'ab'.repeat(32) }, 'sha256'],
    [['GMDSPL-26110030'], 'body'],
  ]
  for (const [body, field] of cases) {
    const res = await POST(post(body))
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal((await res.json()).field, field, JSON.stringify(body))
  }
  const notJson = await POST(new Request(BASE, { method: 'POST', headers: { ...KEY, 'content-length': '25' }, body: 'drawingNo=GMDSPL-26110030' }))
  assert.equal(notJson.status, 400)
  assert.deepEqual(calls, [])
})

test('POST creates as Claude (API), rev 0 and prepared by Claude unless given: 201 new, 200 safe repeat, 404 unknown contract, 409 number taken with a suggestion', async () => {
  const { POST } = await route()
  reset()
  answers.createDrawing = () => ({ success: true, data: entry({ statusAt: new Date().toISOString() }) })
  const created = await POST(post({ poNo: 'PO 42009843', drawingNo: ' gmdspl-26110027 ', docType: 'Merged set', preparedBy: 'Washim', itemCodes: ['FTD040017'] }))
  assert.equal(created.status, 201)
  assert.equal((await created.json()).entry.id, 'd1')
  const [[name, actor, input]] = calls as [string, unknown, Record<string, unknown>][]
  assert.deepEqual([name, actor], ['createDrawing', ACTOR])
  assert.deepEqual(
    [input.contract, input.drawingNo, input.rev, input.docType, input.preparedBy, input.itemCodes],
    ['PO 42009843', 'GMDSPL-26110027', 0, 'Merged set', 'Washim', ['FTD040017']],
  )

  calls.length = 0
  await POST(post({ contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110028', rev: 1, docType: 'QAP' }))
  const second = calls[0][2] as Record<string, unknown>
  assert.deepEqual([second.contract, second.rev, second.preparedBy], ['SD26Y-00067', 1, 'Claude'])

  // The package hands back the existing entry on a repeat: its status time is older than this request.
  answers.createDrawing = { success: true, data: entry() }
  const repeat = await POST(post({ contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }))
  assert.deepEqual([repeat.status, await repeat.json()], [200, { entry: entry() }])

  const outcomes: [unknown, number, object][] = [
    [{ success: false, code: 'not-found', error: 'No contract or PO "PO 1" in Contract Review.' }, 404, { error: 'No contract or PO "PO 1" in Contract Review.' }],
    [
      { success: false, code: 'conflict', error: 'GMDSPL-26110030 is already used on contract SD26Y-00001; next free number GMDSPL-26110031.', suggestion: 'GMDSPL-26110031' },
      409,
      { error: 'GMDSPL-26110030 is already used on contract SD26Y-00001; next free number GMDSPL-26110031.', suggestedDrawingNo: 'GMDSPL-26110031' },
    ],
    [{ success: false, code: 'invalid', error: 'Not on contract SD26Y-00067: FTD999.' }, 400, { error: 'Not on contract SD26Y-00067: FTD999.' }],
    [{ success: false, code: 'error', error: 'Could not add the drawing: server error.' }, 500, { error: 'Could not add the drawing: server error.' }],
  ]
  for (const [answer, status, body] of outcomes) {
    answers.createDrawing = answer
    const res = await POST(post({ contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }))
    assert.deepEqual([res.status, await res.json()], [status, body])
  }
})

test('PATCH refuses a status only Washim or a new revision sets with 403, before any database or Drive call', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Sent to Washim for verification')
  for (const status of ['Verified by Washim', 'Correction required', 'Superseded']) {
    const res = await PATCH(await step(status, ['comment', 'checked'], ['file', pdf()]))
    assert.equal(res.status, 403, status)
    assert.match((await res.json()).error, /cannot set/, status)
  }
  assert.deepEqual(calls, [])
  assert.equal(uploads.length, 0)
})

test('PATCH refuses bad input before any database or Drive call: 400 for non-PDF bytes, over 10 files, a bad link or field, 413 for a file over 25 MB or a body too big to read', async () => {
  const { PATCH } = await route()
  reset()
  const html = new File(['<html><script>alert(1)</script>'], 'gad.pdf', { type: 'application/pdf' })
  const big = new File(['%PDF-', new Uint8Array(25 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
  const eleven: Fields = Array.from({ length: 11 }, (_, i) => ['file', pdf(`page-${i}.pdf`)])
  const cases: [Fields, number, string][] = [
    [[...NO, ['file', html]], 400, 'file'],
    [[...NO, ...eleven], 400, 'file'],
    [[...NO, ['file', 'not a file']], 400, 'file'],
    [[...NO, ['link', 'javascript:alert(1)']], 400, 'link'],
    [[...NO, ['link', `https://drive.google.com/${'x'.repeat(2000)}`]], 400, 'link'],
    [[...NO, ['link', 'https://drive.google.com/a'], ['sha256', 'ab'.repeat(32)]], 400, 'sha256'],
    [[...NO, ['status', 'Approved']], 400, 'status'],
    [[...NO, ['status', 'Sent to client'], ['status', 'Approved by client']], 400, 'status'],
    [[...NO, ['from', 'Sent'], ['status', 'Approved by client'], ['file', pdf()]], 400, 'from'],
    [[...NO, ['from', 'Sent to client'], ['link', 'https://drive.google.com/a']], 400, 'from'],
    [[...NO, ['comment', 'no status with it'], ['link', 'https://drive.google.com/a']], 400, 'comment'],
    [[['drawingNo', 'GMDSPL-26110030'], ['rev', '-1'], ['link', 'https://drive.google.com/a']], 400, 'rev'],
    [[['drawingNo', 'LCC-1'], ['rev', '0'], ['link', 'https://drive.google.com/a']], 400, 'drawingNo'],
    [NO, 400, 'status'],
    [[...NO, ['file', pdf()], ['file', big]], 413, 'file'],
  ]
  for (const [fields, status, field] of cases) {
    const res = await PATCH(await patch(fields))
    const body = await res.json()
    assert.deepEqual([res.status, body.field], [status, field], `${fields.map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : v.name}`).join(' ')}: ${body.error}`)
  }
  const huge = await PATCH(new Request(BASE, { method: 'PATCH', headers: { ...KEY, 'content-length': String(300 * 1024 * 1024) } }))
  assert.equal(huge.status, 413)
  assert.deepEqual(calls, [])
  assert.equal(uploads.length, 0)
})

test('PATCH an allowed step with one PDF: uploaded once, then one changeStatus from the status read, carrying the sha256 of the bytes', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Sent to client')
  answers.changeStatus = { success: true, data: entry({ status: 'Approved by client' }) }

  const res = await PATCH(await step('Approved by client', ['comment', 'Approved by LCC'], ['file', pdf('LCC approved.pdf')], ['link', 'https://mail.google.com/mail/u/0/#inbox/1']))

  assert.deepEqual([res.status, await res.json()], [200, { entry: entry({ status: 'Approved by client' }) }])
  assert.deepEqual(uploads.map((u) => [u.fileName, u.folderId]), [['GMDSPL-26110030 R-0 LCC approved.pdf', 'drawings-folder']])
  assert.deepEqual(calls, [
    ['db', { drawingNo: 'GMDSPL-26110030', rev: 0 }],
    ['changeStatus', ACTOR, 'd1', {
      from: 'Sent to client',
      to: 'Approved by client',
      comment: 'Approved by LCC',
      files: [
        { fileName: 'GMDSPL-26110030 R-0 LCC approved.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: sha256(PDF) },
        { fileUrl: 'https://mail.google.com/mail/u/0/#inbox/1' },
      ],
    }],
  ])
})

test('PATCH answers 404 for an unknown drawing, 409 for a step the flow does not allow (before uploading), a superseded revision or a stale status, 400 for a missing PDF', async () => {
  const { PATCH } = await route()
  reset()
  assert.equal((await PATCH(await step('Sent to client', ['file', pdf()]))).status, 404)
  onDrawing('Draft prepared')
  // Straight from draft to the client would skip Washim's check.
  const skip = await PATCH(await step('Sent to client', ['file', pdf()]))
  assert.deepEqual([skip.status, (await skip.json()).error], [409, 'The api role cannot move a drawing from "Draft prepared" to "Sent to client".'])
  onDrawing('Sent to client')
  const noPdf = await PATCH(await step('Approved by client', ['link', 'https://drive.google.com/a']))
  assert.equal(noPdf.status, 400)
  assert.match((await noPdf.json()).error, /client-approved PDF/)
  // The caller read "Client comments received", but the drawing has moved on since.
  const readEarlier = await PATCH(await step('Approved by client', ['from', 'Client comments received'], ['file', pdf()]))
  assert.deepEqual([readEarlier.status, (await readEarlier.json()).error], [409, 'GMDSPL-26110030 R-0 is now "Sent to client", not "Client comments received" as you read it; GET it again and decide.'])
  assert.equal(uploads.length, 0)

  // Changed between this route's read and the package's: the package's own "from" check answers.
  answers.changeStatus = { success: false, code: 'stale', error: 'This drawing was changed meanwhile; reload and try again.' }
  const stale = await PATCH(await step('Client comments received', ['from', 'Sent to client'], ['comment', 'Change the flange PCD']))
  assert.deepEqual([stale.status, await stale.json()], [409, { error: 'This drawing was changed meanwhile; reload and try again.' }])
  assert.deepEqual(calls.at(-1), ['changeStatus', ACTOR, 'd1', { from: 'Sent to client', to: 'Client comments received', comment: 'Change the flange PCD', files: [] }])
  onDrawing('Superseded')
  assert.equal((await PATCH(await patch([...NO, ['file', pdf()]]))).status, 409)
  assert.equal(uploads.length, 0)
  assert.deepEqual(calls.map(([name]) => name), ['db', 'db', 'db', 'db', 'db', 'changeStatus', 'db'])
})

test('PATCH repeats are safe: the current status again changes nothing (200 with the entry); files sent with it go to addFilesOrLinks, which skips bytes already there', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Approved by client')
  const approved = entry({ status: 'Approved by client' })
  answers.getContractDrawings = { success: true, data: { contract: {}, drawings: [entry({ id: 'd0', rev: 1 }), approved] } }
  const same = await PATCH(await step('Approved by client', ['comment', 'Approved by LCC']))
  assert.deepEqual([same.status, await same.json()], [200, { entry: approved, unchanged: true }])
  assert.deepEqual(calls.map(([name]) => name), ['db', 'getContractDrawings'])

  calls.length = 0
  answers.addFilesOrLinks = { success: true, data: approved }
  const again = await PATCH(await step('Approved by client', ['file', pdf('LCC approved.pdf')]))
  assert.equal(again.status, 200)
  assert.deepEqual(calls[1], ['addFilesOrLinks', ACTOR, 'd1', [
    { fileName: 'GMDSPL-26110030 R-0 LCC approved.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: sha256(PDF) },
  ]])
})

test('only GET, POST and PATCH are exported, so a new method needs its own 401 test above', async () => {
  assert.deepEqual(Object.keys(await route()).sort(), ['GET', 'PATCH', 'POST'])
})

test('write calls must declare a body length (411) within the cap (413) before the body is read: POST 64 KB, PATCH 10 PDFs', async () => {
  const { POST, PATCH } = await route()
  reset()
  const noLength = (method: string, type: string) => new Request(BASE, { method, headers: { ...KEY, 'content-type': type }, body: 'x' })
  assert.equal((await POST(noLength('POST', 'application/json'))).status, 411)
  assert.equal((await PATCH(noLength('PATCH', 'multipart/form-data; boundary=X'))).status, 411)
  const declared = (method: string, bytes: number) => new Request(BASE, { method, headers: { ...KEY, 'content-length': String(bytes) } })
  assert.equal((await POST(declared('POST', 64 * 1024 + 1))).status, 413)
  assert.equal((await PATCH(declared('PATCH', 252 * 1024 * 1024))).status, 413)
  assert.deepEqual(calls, [])
})

test('free text is bounded with a 400 naming the field: POST text 2000, contract 100, item codes 200 x 100; PATCH comment 4000; GET contract 100', async () => {
  const { GET, POST, PATCH } = await route()
  reset()
  const good = { contractNo: 'SD26Y-00067', drawingNo: 'GMDSPL-26110030', docType: 'GAD' }
  const long = (n: number) => 'x'.repeat(n)
  const cases: [object, string][] = [
    [{ ...good, remarks: long(2001) }, 'remarks'],
    [{ ...good, product: long(2001) }, 'product'],
    [{ ...good, preparedBy: long(2001) }, 'preparedBy'],
    [{ ...good, contractNo: long(101) }, 'contractNo'],
    [{ ...good, contractNo: undefined, poNo: long(101) }, 'poNo'],
    [{ ...good, itemCodes: Array.from({ length: 201 }, () => 'A') }, 'itemCodes'],
    [{ ...good, itemCodes: [long(101)] }, 'itemCodes'],
    // M8: a contract reference of the wrong type, or two of them, is not guessed at.
    [{ ...good, contractNo: 123, poNo: '42009843' }, 'contractNo'],
    [{ ...good, contractNo: 'SD26Y-00067', poNo: '42009843' }, 'poNo'],
  ]
  for (const [body, field] of cases) {
    const res = await POST(post(body))
    assert.deepEqual([res.status, (await res.json()).field], [400, field], JSON.stringify(body).slice(0, 80))
  }
  const comment = await PATCH(await step('Sent to client', ['comment', long(4001)]))
  assert.deepEqual([comment.status, (await comment.json()).field], [400, 'comment'])
  assert.equal((await GET(new Request(`${BASE}?contractNo=${long(101)}`, { headers: KEY }))).status, 400)
  assert.deepEqual(calls, [])

  // At the limit it passes.
  answers.createDrawing = { success: true, data: entry() }
  const edge = await POST(post({ ...good, remarks: long(2000), contractNo: long(100), itemCodes: Array.from({ length: 200 }, () => long(100)) }))
  assert.notEqual(edge.status, 400)
})

test('PATCH refuses a bad link that only the URL parser rejects, and odd file names, before any upload', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Sent to client')
  for (const link of ['https://%zz', 'http://[', 'https://exa%mple.com/x']) {
    const res = await PATCH(await step('Approved by client', ['file', pdf()], ['link', link]))
    assert.deepEqual([res.status, (await res.json()).field], [400, 'link'], link)
  }
  for (const name of ['a\u0001b.pdf', 'a\r\nb.pdf', 'evil\u202Efdp.pdf', `${'n'.repeat(200)}.pdf`]) {
    const res = await PATCH(await step('Approved by client', ['file', pdf(name)]))
    assert.deepEqual([res.status, (await res.json()).field], [400, 'file'], JSON.stringify(name))
  }
  assert.equal(uploads.length, 0)
  assert.deepEqual(calls, [])
})

test('PATCH negative paths: not multipart 400, zero-byte file 400, 11 links 400; no package write follows a failed Drive upload (502) or a missing folder (503); a package refusal after upload passes through once; a failing lookup is a generic 500', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Sent to client')
  const text = new Request(BASE, { method: 'PATCH', headers: { ...KEY, 'content-type': 'text/plain', 'content-length': '3' }, body: 'abc' })
  assert.deepEqual([(await PATCH(text)).status], [400])
  const empty = await PATCH(await step('Approved by client', ['file', pdf('empty.pdf', '')]))
  assert.deepEqual([empty.status, (await empty.json()).field], [400, 'file'])
  const links: Fields = Array.from({ length: 11 }, (_, i) => ['link', `https://drive.google.com/${i}`])
  assert.deepEqual([(await (await PATCH(await patch([...NO, ...links]))).json()).field], ['link'])
  assert.deepEqual(calls, [])

  hooks.duringUpload = () => { throw new Error('drive is down') }
  const down = await PATCH(await step('Approved by client', ['file', pdf()]))
  assert.equal(down.status, 502)
  assert.match((await down.json()).error, /nothing was recorded in the register; some files may already be in Drive/)
  assert.deepEqual(callNames(), ['db'])
  hooks.duringUpload = null

  const folder = process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID
  delete process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID
  try {
    assert.equal((await PATCH(await step('Approved by client', ['file', pdf()]))).status, 503)
  } finally {
    process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = folder
  }

  calls.length = 0
  answers.changeStatus = { success: false, code: 'stale', error: 'This drawing was changed meanwhile; reload and try again.' }
  const stale = await PATCH(await step('Approved by client', ['file', pdf()]))
  assert.deepEqual([stale.status, await stale.json()], [409, { error: 'This drawing was changed meanwhile; reload and try again.' }])
  answers.changeStatus = { success: false, code: 'error', error: 'Could not change the status: server error.' }
  assert.equal((await PATCH(await step('Approved by client', ['file', pdf()]))).status, 500)
  assert.equal(callNames().filter((n) => n === 'changeStatus').length, 2)

  dbFails = true
  const broken = await PATCH(await step('Approved by client', ['file', pdf()]))
  assert.deepEqual([broken.status, await broken.json()], [500, { error: 'Could not read the drawing: server error.' }])
})

test('PATCH with the status the entry already has says unchanged: true, also with files; a drawing missing from the contract list is a 500, not an empty 200', async () => {
  const { PATCH } = await route()
  reset()
  onDrawing('Client comments received')
  const mine = entry({ status: 'Client comments received' })
  answers.getContractDrawings = { success: true, data: { contract: {}, drawings: [mine] } }
  const same = await PATCH(await step('Client comments received', ['from', 'Sent to client'], ['comment', 'Client wants PCD 150']))
  assert.deepEqual([same.status, await same.json()], [200, { entry: mine, unchanged: true }])
  assert.deepEqual(calls.map(([n]) => n), ['db', 'getContractDrawings'])

  answers.addFilesOrLinks = { success: true, data: mine }
  const withLink = await PATCH(await step('Client comments received', ['link', 'https://drive.google.com/a']))
  assert.deepEqual([withLink.status, (await withLink.json()).unchanged], [200, true])

  answers.getContractDrawings = { success: true, data: { contract: {}, drawings: [] } }
  assert.equal((await PATCH(await step('Client comments received'))).status, 500)
})
