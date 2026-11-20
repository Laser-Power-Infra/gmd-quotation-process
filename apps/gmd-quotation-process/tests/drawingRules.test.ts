import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAWING_STATUSES, checkMove, movesFor, nextDrawingNo, revLabel } from '@gmd/drawings/columns'

// Puja 18 Nov 2026: statuses in flow order, and who may make each move.
const STATUSES = [
  'Draft prepared',
  'Sent to Washim for verification',
  'Correction required',
  'Verified by Washim',
  'Sent to client',
  'Client comments received',
  'Approved by client',
  'Superseded',
]
const ROLES = ['verifier', 'editor', 'viewer', 'api'] as const
const EDIT = ['verifier', 'editor', 'api']
const ALLOWED: [string, string, string[]][] = [
  ['Draft prepared', 'Sent to Washim for verification', EDIT],
  ['Draft prepared', 'Verified by Washim', ['verifier']],
  ['Sent to Washim for verification', 'Verified by Washim', ['verifier']],
  ['Sent to Washim for verification', 'Correction required', ['verifier']],
  ['Verified by Washim', 'Sent to client', EDIT],
  ['Verified by Washim', 'Correction required', ['verifier']],
  ['Correction required', 'Draft prepared', EDIT],
  ['Sent to client', 'Client comments received', EDIT],
  ['Sent to client', 'Approved by client', EDIT],
  ['Client comments received', 'Approved by client', EDIT],
]
// A comment, a link and an uploaded PDF: enough for any move that needs something.
const FULL = { comment: 'ok', files: 1, pdfs: 1 }
const NONE = { comment: '', files: 0, pdfs: 0 }

test('drawing numbers continue from GMDSPL-26110029 in November 2026 and restart each month, in India time', () => {
  const nov = new Date('2026-11-20T06:00:00Z')
  assert.equal(nextDrawingNo([], nov), 'GMDSPL-26110030')
  // Other months, and numbers that are not 4-digit serials, do not move the count.
  assert.equal(nextDrawingNo(['GMDSPL-26110041', 'GMDSPL-26100099', 'GMDSPL-2611009', 'GMDSPL-26110050A'], nov), 'GMDSPL-26110042')
  assert.equal(nextDrawingNo(['GMDSPL-26110041'], new Date('2026-12-02T06:00:00Z')), 'GMDSPL-26120001')
  // 30 Nov 19:00 UTC is already 1 Dec 00:30 in India; 18:00 UTC is still 30 Nov 23:30.
  assert.equal(nextDrawingNo(['GMDSPL-26110041'], new Date('2026-11-30T19:00:00Z')), 'GMDSPL-26120001')
  assert.equal(nextDrawingNo([], new Date('2026-11-30T18:00:00Z')), 'GMDSPL-26110030')
  assert.equal(nextDrawingNo(['GMDSPL-27010009'], new Date('2027-01-15T06:00:00Z')), 'GMDSPL-27010010')
})

test('statuses are listed in flow order and a rev reads R-n', () => {
  assert.deepEqual([...DRAWING_STATUSES], STATUSES)
  assert.equal(revLabel(0), 'R-0')
  assert.equal(revLabel(3), 'R-3')
})

test('every move in the table is allowed for exactly its roles; every other move is refused for everyone', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      for (const role of ROLES) {
        const row = ALLOWED.find(([f, t]) => f === from && t === to)
        const refused = checkMove(from, to, role, FULL)
        if (row?.[2].includes(role)) assert.equal(refused, null, `${role}: ${from} -> ${to}`)
        else assert.equal(refused?.code, 'not-allowed', `${role}: ${from} -> ${to}`)
      }
    }
  }
})

test('Superseded is never chosen directly, even by the verifier', () => {
  for (const from of STATUSES) {
    const refused = checkMove(from, 'Superseded', 'verifier', FULL)
    assert.equal(refused?.code, 'not-allowed')
    assert.match(refused!.error, /new revision/)
  }
})

test('a move is refused without the comment, file or PDF it needs in the same step', () => {
  const correction = ['Sent to Washim for verification', 'Correction required'] as const
  assert.equal(checkMove(...correction, 'verifier', NONE)?.code, 'invalid')
  assert.equal(checkMove(...correction, 'verifier', { ...NONE, comment: '   ', files: 1, pdfs: 1 })?.code, 'invalid')
  assert.equal(checkMove(...correction, 'verifier', { ...NONE, comment: 'flange drilling wrong' }), null)
  assert.equal(checkMove('Verified by Washim', 'Correction required', 'verifier', NONE)?.code, 'invalid')

  // Client comments: the comments typed in, or their file / link.
  assert.equal(checkMove('Sent to client', 'Client comments received', 'api', NONE)?.code, 'invalid')
  assert.equal(checkMove('Sent to client', 'Client comments received', 'api', { ...NONE, files: 1 }), null)
  assert.equal(checkMove('Sent to client', 'Client comments received', 'api', { ...NONE, comment: 'see mail' }), null)

  // Approval: an uploaded PDF, a link alone is not the approved copy.
  for (const from of ['Sent to client', 'Client comments received']) {
    assert.equal(checkMove(from, 'Approved by client', 'editor', { comment: 'approved', files: 1, pdfs: 0 })?.code, 'invalid')
    assert.equal(checkMove(from, 'Approved by client', 'api', { ...NONE, files: 1, pdfs: 1 }), null)
  }

  // Moves that need nothing pass with an empty step.
  assert.equal(checkMove('Draft prepared', 'Sent to Washim for verification', 'api', NONE), null)
  assert.equal(checkMove('Draft prepared', 'Verified by Washim', 'verifier', NONE), null)
})

test("the status dropdown offers only the actor's own moves", () => {
  const to = (status: string, role: (typeof ROLES)[number]) => movesFor(status, role).map((m) => m.to)
  assert.deepEqual(to('Sent to Washim for verification', 'verifier'), ['Correction required', 'Verified by Washim'])
  assert.deepEqual(to('Sent to Washim for verification', 'editor'), [])
  assert.deepEqual(to('Draft prepared', 'api'), ['Sent to Washim for verification'])
  assert.deepEqual(to('Draft prepared', 'verifier'), ['Sent to Washim for verification', 'Verified by Washim'])
  assert.deepEqual(to('Sent to client', 'viewer'), [])
  assert.deepEqual(to('Approved by client', 'verifier'), [])
})
