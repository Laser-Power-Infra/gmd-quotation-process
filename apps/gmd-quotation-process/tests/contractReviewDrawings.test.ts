import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { coveredOrNull, mailTagFills, resyncAll, resyncEach } from '../lib/contractReviewLinks.js'

// tsx compiles the package's JSX with the classic runtime; the cell is imported after React is global.
;(globalThis as { React?: unknown }).React = React
const cellPath = '../../../packages/contract-review/src/ui/MailDocsCell.tsx'

const TAGS = JSON.stringify([
  { c: 'MC', u: 'https://mail.google.com/y', at: '2026-10-22T08:00:00Z' },
  { c: 'Drawing approval', u: 'https://mail.google.com/x', at: '2026-10-21T08:00:00Z' },
])
// Cells per line: [APPROVAL DATE, MC DATE, MAILS]; both lines are blank and tagged.
const rows = [
  ['', '', TAGS],
  ['', '', TAGS],
]
const ids = ['covered', 'free']
const fills = (idx: number, tag: 'MC' | 'Drawing approval', skip?: Set<string>) =>
  mailTagFills({ ids, rows, idx, mailDocsIdx: 2, tag, skip })

test('APPROVAL DATE mail-tag fill skips a covered line and fills an uncovered one', () => {
  assert.deepEqual(fills(0, 'Drawing approval', new Set(['covered'])), [{ id: 'free', day: '21-Oct-2026' }])
})

test('without a covered set the APPROVAL DATE fill is as before; MC DATE fills both lines', () => {
  assert.equal(fills(0, 'Drawing approval').length, 2)
  assert.deepEqual(fills(1, 'MC'), [{ id: 'covered', day: '22-Oct-2026' }, { id: 'free', day: '22-Oct-2026' }])
})

test('the drawings re-sync runs once per contract and a failing one does not stop the rest', async () => {
  const seen: string[] = []
  const res = await resyncEach(['A', 'B', 'C'], async (c) => {
    seen.push(c)
    if (c === 'B') throw new Error('boom')
  })
  assert.deepEqual(seen, ['A', 'B', 'C'])
  assert.deepEqual(res, { done: 2, failed: 1 })
})

test('a failing drawings lookup yields null (APPROVAL DATE fill skipped) while MC DATE still fills', async () => {
  const covered = await coveredOrNull(ids, async () => { throw new Error('relation "ContractDrawing" does not exist') })
  assert.equal(covered, null)
  // the job's rule: no covered set, no APPROVAL DATE fill; MC DATE does not depend on it
  const approval = covered ? fills(0, 'Drawing approval', covered) : []
  assert.deepEqual(approval, [])
  assert.equal(fills(1, 'MC').length, 2)
  assert.deepEqual([...(await coveredOrNull(ids, async () => new Set(['covered'])))!], ['covered'])
})

test('a failing contract list skips the re-sync as one failure; a failing contract does not stop the others', async () => {
  assert.deepEqual(await resyncAll(async () => { throw new Error('no table') }, async () => {}), { done: 0, failed: 1 })
  const seen: string[] = []
  const res = await resyncAll(async () => ['A', 'B', 'C'], async (c) => { seen.push(c); if (c === 'A') throw new Error('x') })
  assert.deepEqual(seen, ['A', 'B', 'C'])
  assert.deepEqual(res, { done: 2, failed: 1 })
})

test('the Drawings & QAP button shows only when the host passes drawings', async () => {
  const { MailDocsCell } = (await import(cellPath)) as typeof import('../../../packages/contract-review/src/ui/MailDocsCell')
  const html = (onShowDrawings?: () => void) => renderToStaticMarkup(createElement(MailDocsCell, { value: '[]', onShowDrawings }))
  assert.ok(!html().includes('Drawings &amp; QAP'))
  assert.ok(html(() => {}).includes('Drawings &amp; QAP'))
})
