import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hooks, uploads } from './fake-gdrive.mjs'

// lib/drawingFiles is imported inside each test, after the Drive fake is in place.
const BODY = '%PDF-1.7\n1 0 obj\n'
const pdf = (name: string, body = BODY) => new File([body], name, { type: 'application/pdf' })
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

test('drawing PDFs go to the drawings Drive folder, named by drawing no and rev, with the sha256 of their bytes', async () => {
  const { uploadDrawingPdfs } = await import('../lib/drawingFiles.js')
  process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'
  uploads.length = 0

  const res = await uploadDrawingPdfs([pdf('GAD sluice valve.pdf'), pdf('QAP.pdf', '%PDF-1.4 qap')], 'GMDSPL-26110030', 1)

  assert.deepEqual(res, {
    success: true,
    data: [
      { fileName: 'GMDSPL-26110030 R-1 GAD sluice valve.pdf', fileUrl: 'https://drive.google.com/file/d/drive-1/view', sha256: sha256(BODY) },
      { fileName: 'GMDSPL-26110030 R-1 QAP.pdf', fileUrl: 'https://drive.google.com/file/d/drive-2/view', sha256: sha256('%PDF-1.4 qap') },
    ],
  })
  assert.deepEqual(uploads.map((u) => [u.fileName, u.mimeType, u.folderId]), [
    ['GMDSPL-26110030 R-1 GAD sluice valve.pdf', 'application/pdf', 'drawings-folder'],
    ['GMDSPL-26110030 R-1 QAP.pdf', 'application/pdf', 'drawings-folder'],
  ])
  assert.equal(Buffer.from(uploads[0].base64Data, 'base64').toString(), BODY)
})

test('non-PDF bytes, a file over 25 MB, an empty pick or no drawings folder set reach no Drive', async () => {
  const { uploadDrawingPdfs } = await import('../lib/drawingFiles.js')
  process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'
  uploads.length = 0
  const big = new File(['%PDF-', new Uint8Array(25 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
  const cases: [File[], RegExp][] = [
    // An HTML page sent as a PDF: its first bytes give it away.
    [[new File(['<html><script>alert(1)</script>'], 'gad.pdf', { type: 'application/pdf' })], /"gad\.pdf" is not a PDF/],
    [[pdf('ok.pdf'), new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], 'scan.png', { type: 'image/png' })], /"scan\.png" is not a PDF/],
    [[pdf('ok.pdf'), big], /"big\.pdf" is larger than 25 MB/],
    [[], /No files/],
  ]
  for (const [files, error] of cases) {
    const res = await uploadDrawingPdfs(files, 'GMDSPL-26110030', 0)
    assert.ok(!res.success && error.test(res.error), `[${files.map((f) => f.name).join(', ')}]: ${JSON.stringify(res)}`)
  }
  delete process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID
  const unset = await uploadDrawingPdfs([pdf('ok.pdf')], 'GMDSPL-26110030', 0)
  assert.ok(!unset.success && /GMD_DRAWINGS_DRIVE_FOLDER_ID/.test(unset.error), JSON.stringify(unset))
  assert.equal(uploads.length, 0)
})

test('a Drive failure comes back as an error result, not a crash', async () => {
  const { uploadDrawingPdfs } = await import('../lib/drawingFiles.js')
  process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID = 'drawings-folder'
  hooks.duringUpload = () => {
    throw new Error('quota exceeded')
  }
  try {
    const res = await uploadDrawingPdfs([pdf('gad.pdf')], 'GMDSPL-26110030', 0)
    assert.ok(!res.success && /quota exceeded/.test(res.error), JSON.stringify(res))
  } finally {
    hooks.duringUpload = null
  }
})
