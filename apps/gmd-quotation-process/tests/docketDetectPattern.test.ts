import test from 'node:test'
import assert from 'node:assert/strict'
import { detectDocketNumber } from '../schedular_function/docket-followup-sync.js'

test('docket request wording is not mistaken for a docket number', () => {
  for (const subject of [
    'Fwd: Request for Docket Creation',
    'Kindly create docket against attached RFQ',
    'pls create docket asap',
    'Docket request - BHEL enquiry',
    'Please create docket',
  ]) {
    assert.equal(detectDocketNumber({ subject }), null, subject)
  }
})

test('real docket numbers are still detected', () => {
  assert.equal(detectDocketNumber({ subject: 'Docket No: GMD/2026-27/101' }), 'GMD/2026-27/101')
  assert.equal(detectDocketNumber({ subject: 'docket no. 2611' }), '2611')
  assert.equal(detectDocketNumber({ subject: 'Docket# ENQ-1234' }), 'ENQ-1234')
  assert.equal(detectDocketNumber({ subject: 'Re: GMD-12345 rates' }), 'GMD-12345')
})

test('GeM / e-proc refs in docket_no are not dockets', async () => {
  const { isTenderRefNotDocket, hasRealDocketNo } = await import('../lib/docketPending.js')
  assert.equal(isTenderRefNotDocket('GEM/2026/B/8168518'), true)
  assert.equal(isTenderRefNotDocket('2026_WBSED_123456_1'), true)
  assert.equal(hasRealDocketNo('GEM/2026/B/8168518'), false)
  assert.equal(hasRealDocketNo('GMD/2026-27/589'), true)
  assert.equal(hasRealDocketNo(null), false)
  assert.equal(detectDocketNumber({ docketNo: 'GEM/2026/B/8168518', subject: 'Fwd: VALVE ENQUIRY FOR CCL_BID-GEM/2026/B/8168518' }), null)
  assert.equal(detectDocketNumber({ docketNo: 'GEM/2026/B/1', body: 'docket no GMD/2026-27/600 created' }), 'GMD/2026-27/600')
})

test('AI input keeps the end of a long thread', async () => {
  const { buildDocketAiInput } = await import('../lib/docketAiValidator.js')
  const body = '--- Message 1 From: client ---\n' + 'x'.repeat(20000) + '\n--- Message 2 From: Puja ---\nPlease create a docket'
  const out = buildDocketAiInput({ subject: 'RFQ', body })
  assert.ok(out.includes('Please create a docket'))
  assert.ok(out.includes('Message 1 From: client'))
  assert.ok(out.length < 7500)
})

test('AI input keeps a short reply in the middle of a long thread', async () => {
  const { buildDocketAiInput } = await import('../lib/docketAiValidator.js')
  const body = [
    '--- Message 1 From: client ---\n' + 'a'.repeat(9000),
    '--- Message 2 From: Laser Entry ---\nPlease refer-GMD/2026-27/585\n' + 'b'.repeat(9000),
    '--- Message 3 From: client ---\n' + 'c'.repeat(9000),
  ].join('\n')
  assert.ok(buildDocketAiInput({ body }).includes('GMD/2026-27/585'))
})
