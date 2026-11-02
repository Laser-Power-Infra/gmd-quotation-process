import test from 'node:test'
import assert from 'node:assert/strict'
import {
  daysBetweenDateOnly,
  getExpiryHighlight,
  isClosedStatus,
} from '../lib/pbg/expiry-status.js'

const TODAY = '2026-11-02'

test('daysBetweenDateOnly compares ISO date-only strings', () => {
  assert.equal(daysBetweenDateOnly('2026-11-02', TODAY), 0)
  assert.equal(daysBetweenDateOnly('2026-11-03', TODAY), 1)
  assert.equal(daysBetweenDateOnly('2026-11-01', TODAY), -1)
  assert.equal(daysBetweenDateOnly('2026-12-02', TODAY), 30)
  assert.equal(daysBetweenDateOnly('2026-12-03', TODAY), 31)
})

test('blank or invalid expiry dates are not highlighted', () => {
  for (const value of [null, undefined, '', '   ', 'not-a-date']) {
    assert.equal(getExpiryHighlight(value, TODAY), null, String(value))
  }
})

test('expired and expiring windows use the 30-day threshold', () => {
  assert.equal(getExpiryHighlight('2026-10-01', TODAY), 'expired')
  assert.equal(getExpiryHighlight('2026-11-01', TODAY), 'expired')
  // Expires today is treated as expired, matching the reminder job.
  assert.equal(getExpiryHighlight('2026-11-02', TODAY), 'expired')
  assert.equal(getExpiryHighlight('2026-11-03', TODAY), 'expiring')
  assert.equal(getExpiryHighlight('2026-12-02', TODAY), 'expiring')
  assert.equal(getExpiryHighlight('2026-12-03', TODAY), null)
})

test('closed guarantees are never highlighted', () => {
  for (const status of ['closed', 'Closed', 'CLOSE', ' close ']) {
    assert.equal(
      getExpiryHighlight('2026-10-01', TODAY, status),
      null,
      String(status),
    )
  }
})

test('open and running guarantees are still highlighted by date', () => {
  for (const status of ['open', 'Running', 'EXPIRED', null, '']) {
    assert.equal(
      getExpiryHighlight('2026-10-01', TODAY, status),
      'expired',
      String(status),
    )
  }
})

test('isClosedStatus understands the closed and close spellings', () => {
  assert.equal(isClosedStatus('Closed'), true)
  assert.equal(isClosedStatus('CLOSE'), true)
  assert.equal(isClosedStatus('running'), false)
  assert.equal(isClosedStatus(null), false)
})
