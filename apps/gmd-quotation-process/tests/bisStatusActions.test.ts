import test from 'node:test'
import assert from 'node:assert/strict'
import { driveFiles, hooks, uploads } from './fake-gdrive.mjs'

// @gmd/db-quotation reuses globalThis.quotationPrisma, so this fake stands in for
// the database. Actions are imported inside each test, after the fakes are in place.
type Row = { id: string; bisNo: string; bisDocs: string | null; createdAt?: Date }
type Update = { bisStatusId: string; createdAt: Date }
const db = { rows: [] as Row[], updates: [] as Update[], creates: [] as Record<string, unknown>[] }
;(globalThis as unknown as { quotationPrisma: unknown }).quotationPrisma = {
  // Stands in for the single append UPDATE in uploadBisDocsAction (bound values: links, id).
  $queryRaw: async (_sql: TemplateStringsArray, links: string, id: string) => {
    const row = db.rows.find((r) => r.id === id)
    if (!row) return []
    row.bisDocs = [row.bisDocs?.replace(/^[\s,]+|[\s,]+$/g, ''), links].filter(Boolean).join(', ')
    return [{ bisDocs: row.bisDocs }]
  },
  bisStatus: {
    findUnique: async ({ where }: { where: { id: string } }) => db.rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: { where: { id: { notIn: string[] }; createdAt?: { lt: Date } } }) =>
      db.rows
        .filter((r) => !where.id.notIn.includes(r.id) && !(where.createdAt && r.createdAt! >= where.createdAt.lt))
        .map((r) => ({ id: r.id })),
    create: async ({ data }: { data: Row }) => {
      if (db.rows.some((r) => r.bisNo === data.bisNo)) {
        throw Object.assign(new Error('Unique constraint failed on the fields: (`bisNo`)'), { code: 'P2002' })
      }
      db.creates.push(data)
      return { id: 'new-id' }
    },
  },
  bisStatusUpdate: {
    findMany: async ({ where }: { where: { createdAt: { gte: Date } } }) =>
      db.updates.filter((u) => u.createdAt >= where.createdAt.gte).map((u) => ({ bisStatusId: u.bisStatusId })),
  },
}

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

test('uploaded licence copies are appended to the links already on the BIS row', async () => {
  const { uploadBisDocsAction } = await import('../app/actions/misc.js')
  db.rows = [{ id: 'bis-1', bisNo: 'IS 14846', bisDocs: 'https://drive.google.com/file/d/old/view' }]
  uploads.length = 0
  const jpg = new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)], 'scan.jpg', { type: 'image/jpeg' })

  const res = await uploadBisDocsAction('bis-1', [pdf('licence.pdf'), jpg])

  const bisDocs = 'https://drive.google.com/file/d/old/view, https://drive.google.com/file/d/drive-1/view, https://drive.google.com/file/d/drive-2/view'
  assert.deepEqual(res, { success: true, data: { bisDocs } })
  assert.equal(db.rows[0].bisDocs, bisDocs)
  assert.deepEqual(uploads.map((u) => [u.fileName, u.mimeType]), [['licence.pdf', 'application/pdf'], ['scan.jpg', 'image/jpeg']])
})

test('an upload to a row without links stores just the new link', async () => {
  const { uploadBisDocsAction } = await import('../app/actions/misc.js')
  db.rows = [{ id: 'bis-1', bisNo: 'IS 14846', bisDocs: null }]
  uploads.length = 0

  await uploadBisDocsAction('bis-1', [pdf('licence.pdf')])

  assert.equal(db.rows[0].bisDocs, 'https://drive.google.com/file/d/drive-1/view')
})

test('a link pasted onto the row while the upload is in flight is kept with the old and new links', async () => {
  const { uploadBisDocsAction } = await import('../app/actions/misc.js')
  db.rows = [{ id: 'bis-1', bisNo: 'IS 14846', bisDocs: 'https://drive.google.com/file/d/old/view' }]
  uploads.length = 0
  hooks.duringUpload = () => {
    db.rows[0].bisDocs += ', https://example.com/pasted.pdf'
  }

  let res
  try {
    res = await uploadBisDocsAction('bis-1', [pdf('licence.pdf')])
  } finally {
    hooks.duringUpload = null
  }

  const bisDocs = 'https://drive.google.com/file/d/old/view, https://example.com/pasted.pdf, https://drive.google.com/file/d/drive-1/view'
  assert.deepEqual(res, { success: true, data: { bisDocs } })
  assert.equal(db.rows[0].bisDocs, bisDocs)
})

test('an unknown row, an empty or too-large pick, a file that is not really a PDF/image or one over 25 MB is refused before anything reaches Drive', async () => {
  const { uploadBisDocsAction } = await import('../app/actions/misc.js')
  db.rows = [{ id: 'bis-1', bisNo: 'IS 14846', bisDocs: null }]
  uploads.length = 0
  const big = new File(['%PDF-', new Uint8Array(25 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
  const cases: [string, File[], RegExp][] = [
    ['missing', [pdf('licence.pdf')], /not found/],
    ['bis-1', [], /No files/],
    ['bis-1', Array.from({ length: 11 }, (_, i) => pdf(`page-${i}.pdf`)), /at most 10/],
    ['bis-1', [new File(['<script>'], 'page.html', { type: 'text/html' })], /PDF, PNG, JPEG, WEBP or GIF/],
    // An HTML page sent as a PDF: its first bytes give it away.
    ['bis-1', [new File(['<html><script>alert(1)</script>'], 'licence.pdf', { type: 'application/pdf' })], /PDF, PNG, JPEG, WEBP or GIF/],
    ['bis-1', [new File(['%PDF-1.4'], 'licence.pdf', { type: 'constructor' })], /PDF, PNG, JPEG, WEBP or GIF/],
    ['bis-1', [pdf('ok.pdf'), big], /25 MB/],
  ]

  for (const [id, files, error] of cases) {
    const res = await uploadBisDocsAction(id, files)
    assert.ok(!res.success && error.test(res.error), `${id} [${files.map((f) => f.name).join(', ')}]: ${JSON.stringify(res)}`)
  }
  assert.equal(uploads.length, 0)
  assert.equal(db.rows[0].bisDocs, null)
})

test('a BIS row is flagged after 3 days without an update, but a row added inside that window is not', async () => {
  const { getBisStaleIdsAction } = await import('../app/actions/misc.js')
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
  db.rows = [
    { id: 'added-yesterday', bisNo: 'A', bisDocs: null, createdAt: daysAgo(1) },
    { id: 'never-updated', bisNo: 'B', bisDocs: null, createdAt: daysAgo(10) },
    { id: 'updated-yesterday', bisNo: 'C', bisDocs: null, createdAt: daysAgo(10) },
    { id: 'updated-last-week', bisNo: 'D', bisDocs: null, createdAt: daysAgo(10) },
  ]
  db.updates = [
    { bisStatusId: 'updated-yesterday', createdAt: daysAgo(1) },
    { bisStatusId: 'updated-last-week', createdAt: daysAgo(8) },
  ]

  const res = await getBisStaleIdsAction()

  assert.deepEqual(res, { success: true, data: ['never-updated', 'updated-last-week'] })
})

test('the attachment route shows only PDFs and plain images inline and sends anything else as a nosniff download', async () => {
  const { GET } = await import('../app/api/attachments/[fileId]/route.js')
  const cases = [
    ['application/pdf', 'inline'],
    ['image/png', 'inline'],
    ['text/html', 'attachment'],
    ['image/svg+xml', 'attachment'],
  ]

  for (const [mimeType, disposition] of cases) {
    driveFiles.set('file-1', { buffer: Buffer.from('<svg onload="alert(1)"/>'), mimeType, name: 'BIS licence' })
    const res = await GET(new Request('http://localhost/api/attachments/file-1'), { params: Promise.resolve({ fileId: 'file-1' }) })
    assert.equal(res.headers.get('content-type'), disposition === 'inline' ? mimeType : 'application/octet-stream', mimeType)
    assert.equal(res.headers.get('content-disposition'), `${disposition}; filename*=UTF-8''BIS%20licence`, mimeType)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', mimeType)
  }
})

test('a new BIS row is saved with trimmed fields, blanks as null and a date-only expiry', async () => {
  const { createBisStatusAction } = await import('../app/actions/misc.js')
  db.rows = []
  db.creates = []

  const res = await createBisStatusAction({
    itemName: ' Sluice valve ',
    bisNo: ' IS 14846 ',
    licenseNo: '  ',
    applicationStatus: 'NEW APPLICATION',
    expiryDate: '2027-03-31',
  })

  assert.deepEqual(res, { success: true, data: { id: 'new-id' } })
  assert.deepEqual(db.creates, [{
    itemName: 'Sluice valve',
    bisNo: 'IS 14846',
    licenseNo: null,
    applicationStatus: 'NEW APPLICATION',
    expiryDate: new Date(Date.UTC(2027, 2, 31)),
  }])
})

test('a new BIS row is refused without a BIS No, with a bad expiry date or with a BIS No already listed', async () => {
  const { createBisStatusAction } = await import('../app/actions/misc.js')
  db.rows = [{ id: 'bis-1', bisNo: 'IS 14846', bisDocs: null }]
  db.creates = []

  const blank = await createBisStatusAction({ bisNo: '   ', itemName: 'Sluice valve' })
  const badDate = await createBisStatusAction({ bisNo: 'IS 780', expiryDate: '31st March' })
  const duplicate = await createBisStatusAction({ bisNo: 'IS 14846' })

  assert.ok(!blank.success && /BIS No/.test(blank.error), JSON.stringify(blank))
  assert.ok(!badDate.success && /expiry/i.test(badDate.error), JSON.stringify(badDate))
  assert.ok(!duplicate.success && /IS 14846.*already/.test(duplicate.error), JSON.stringify(duplicate))
  assert.deepEqual(db.creates, [])
})
