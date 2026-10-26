import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSubject,
  snapshotFingerprint,
  uniqueWork,
  planPendingDocketDedupe,
  type DocketFacts,
  type ThreadFacts,
} from '../lib/docketDedupe.js'

const at = (iso: string) => new Date(iso)

function docket(overrides: Partial<DocketFacts> = {}): DocketFacts {
  return {
    id: 'd1',
    docketNumber: 'GMD/2026-27/1',
    partyName: 'ACME',
    createdAt: at('2026-10-01T00:00:00Z'),
    sourceThreadId: null,
    items: 0,
    selectedContractNo: [],
    offerPdfGeneratedAt: null,
    emailApproved: false,
    emailSentBy: null,
    duplicate: null,
    duplicateOfDocket: null,
    attachmentUrls: [],
    ...overrides,
  }
}

function thread(overrides: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    threadId: 't1',
    docketNo: null,
    subject: 'RFQ for valves',
    sender: 'Buyer <buyer@acme.com>',
    date: at('2026-10-01T10:00:00Z'),
    bodyPreview: 'Please quote 2 gate valves.',
    attachNames: [],
    attachLinks: [],
    ...overrides,
  }
}

test('normalizeSubject strips repeated Re:/Fwd: prefixes and normalises spacing', () => {
  assert.equal(normalizeSubject('  Re: Fwd:  RFQ for valves '), 'rfq for valves')
  assert.equal(normalizeSubject('RFW: not a reply prefix'), 'rfw: not a reply prefix')
  assert.equal(normalizeSubject(null), '')
})

test('snapshotFingerprint ignores reply prefixes but changes with the mail content', () => {
  const base = thread()
  const same = thread({ subject: 'Re: Fwd: RFQ FOR VALVES', bodyPreview: 'Please  quote 2 gate valves.' })
  const otherBody = thread({ bodyPreview: 'Please quote 3 gate valves.' })
  const otherDate = thread({ date: at('2026-10-01T10:00:01Z') })

  assert.equal(snapshotFingerprint(base), snapshotFingerprint(same))
  assert.notEqual(snapshotFingerprint(base), snapshotFingerprint(otherBody))
  assert.notEqual(snapshotFingerprint(base), snapshotFingerprint(otherDate))
})

test('snapshotFingerprint requires subject, sender, date and some content', () => {
  assert.equal(snapshotFingerprint(thread({ date: null })), null)
  assert.equal(snapshotFingerprint(thread({ sender: 'no address' })), null)
  assert.equal(snapshotFingerprint(thread({ bodyPreview: '', attachNames: [] })), null)
})

test('two pending dockets on the same thread keep the earliest', () => {
  const first = docket({ id: 'd1', sourceThreadId: 't1', createdAt: at('2026-10-01T00:00:00Z') })
  const second = docket({
    id: 'd2',
    docketNumber: 'GMD/2026-27/2',
    createdAt: at('2026-10-02T00:00:00Z'),
    attachmentUrls: ['https://drive.example/mail.pdf'],
  })
  const threads = [thread({ threadId: 't1', attachLinks: ['https://drive.example/mail.pdf'] })]

  const plan = planPendingDocketDedupe([first, second], threads)

  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].keeper.id, 'd1')
  assert.deepEqual(plan.groups[0].deletes.map((d) => d.id), ['d2'])
  assert.deepEqual(plan.groups[0].threadIds, ['t1'])
  assert.deepEqual(plan.groups[0].evidence, ['thread'])
})

test('a blank docket is deleted when a docket with items is the keeper', () => {
  const blank = docket({ id: 'd1' })
  const keeper = docket({ id: 'd2', docketNumber: 'GMD/2026-27/2', items: 3, sourceThreadId: 't1' })
  const threads = [thread({ threadId: 't1', docketNo: blank.docketNumber })]

  const plan = planPendingDocketDedupe([blank, keeper], threads)

  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].keeper.id, 'd2')
  assert.deepEqual(plan.groups[0].deletes.map((d) => d.id), ['d1'])
})

test('the same mail imported under a second thread id is folded by snapshot', () => {
  const first = docket({ id: 'd1', sourceThreadId: 't1' })
  const second = docket({
    id: 'd2',
    docketNumber: 'GMD/2026-27/2',
    sourceThreadId: 't2',
    createdAt: at('2026-10-02T00:00:00Z'),
  })
  const threads = [thread({ threadId: 't1' }), thread({ threadId: 't2' })]

  const plan = planPendingDocketDedupe([first, second], threads)

  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].keeper.id, 'd1')
  assert.deepEqual(plan.groups[0].deletes.map((d) => d.id), ['d2'])
  assert.deepEqual([...plan.groups[0].threadIds].sort(), ['t1', 't2'])
  assert.deepEqual(plan.groups[0].evidence, ['snapshot'])
})

test('different mail content in two threads is not treated as a duplicate', () => {
  const first = docket({ id: 'd1', sourceThreadId: 't1' })
  const second = docket({ id: 'd2', docketNumber: 'GMD/2026-27/2', sourceThreadId: 't2' })
  const threads = [
    thread({ threadId: 't1' }),
    thread({ threadId: 't2', bodyPreview: 'Please quote 3 gate valves.' }),
  ]

  const plan = planPendingDocketDedupe([first, second], threads)

  assert.equal(plan.groups.length, 0)
})

test('a zero-item docket carrying work is reported, never deleted', () => {
  const keeper = docket({ id: 'd1', items: 2, sourceThreadId: 't1' })
  const blank = docket({ id: 'd2', docketNumber: 'GMD/2026-27/2', sourceThreadId: 't1' })
  const worked = docket({
    id: 'd3',
    docketNumber: 'GMD/2026-27/3',
    sourceThreadId: 't1',
    selectedContractNo: ['C-100'],
  })
  const threads = [thread({ threadId: 't1' })]

  const plan = planPendingDocketDedupe([keeper, blank, worked], threads)

  assert.equal(plan.groups.length, 1)
  assert.deepEqual(plan.groups[0].deletes.map((d) => d.id), ['d2'])
  assert.deepEqual(plan.skippedWork.map((x) => x.docket.id), ['d3'])
  assert.deepEqual(plan.skippedWork[0].work, ['selectedContract=C-100'])
})

test('a docket with no source thread is left alone', () => {
  const orphan = docket({ id: 'd1', attachmentUrls: [] })
  const threads = [thread({ threadId: 't1', docketNo: 'GMD/2026-27/999' })]

  const plan = planPendingDocketDedupe([orphan], threads)

  assert.equal(plan.groups.length, 0)
  assert.deepEqual(plan.unresolved.map((d) => d.id), ['d1'])
})

test('attachments matching several threads are ambiguous, not deleted', () => {
  const orphan = docket({ id: 'd1', attachmentUrls: ['https://drive.example/shared.pdf'] })
  const threads = [
    thread({ threadId: 't1', attachLinks: ['https://drive.example/shared.pdf'] }),
    thread({ threadId: 't2', attachLinks: ['https://drive.example/shared.pdf'] }),
  ]

  const plan = planPendingDocketDedupe([orphan], threads)

  assert.equal(plan.groups.length, 0)
  assert.equal(plan.skippedAmbiguous.length, 1)
})

test('a manual duplicate flag leaves the group to the user', () => {
  const blank = docket({ id: 'd1', sourceThreadId: 't1' })
  const flagged = docket({
    id: 'd2',
    docketNumber: 'GMD/2026-27/2',
    sourceThreadId: 't1',
    duplicate: 'Yes',
    duplicateOfDocket: 'GMD/2026-27/9',
  })
  const threads = [thread({ threadId: 't1' })]

  const plan = planPendingDocketDedupe([blank, flagged], threads)

  assert.equal(plan.groups.length, 0)
  assert.equal(plan.skippedAmbiguous.length, 1)
  assert.equal(plan.skippedAmbiguous[0].reason, 'manual duplicate flag')
})

test('the per-run cap defers the rest to the next hour', () => {
  const d1 = docket({ id: 'd1', sourceThreadId: 't1' })
  const d2 = docket({
    id: 'd2',
    docketNumber: 'GMD/2026-27/2',
    sourceThreadId: 't1',
    createdAt: at('2026-10-02T00:00:00Z'),
  })
  const d3 = docket({
    id: 'd3',
    docketNumber: 'GMD/2026-27/3',
    sourceThreadId: 't1',
    createdAt: at('2026-10-03T00:00:00Z'),
  })
  const threads = [thread({ threadId: 't1' })]

  const plan = planPendingDocketDedupe([d1, d2, d3], threads, 1)

  assert.equal(plan.groups.length, 1)
  assert.deepEqual(plan.groups[0].deletes.map((d) => d.id), ['d2'])
  assert.equal(plan.deferred, 1)
})

test('duplicate flags count as work', () => {
  assert.deepEqual(uniqueWork(docket({ duplicate: 'Yes' })), ['duplicate=Yes'])
  assert.deepEqual(uniqueWork(docket({ duplicateOfDocket: 'GMD/2026-27/9' })), [
    'duplicateOf=GMD/2026-27/9',
  ])
})
