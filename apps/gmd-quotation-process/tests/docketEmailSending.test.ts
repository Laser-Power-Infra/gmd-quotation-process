import test from 'node:test'
import assert from 'node:assert/strict'
import { isDocketEmailSending, DOCKET_EMAIL_SENDING_STALE_MS } from '../lib/docketEmailTemplate.js'

const now = Date.parse('2026-11-17T05:43:41Z')

test('no claim means not sending', () => {
  assert.equal(isDocketEmailSending(null, now), false)
  assert.equal(isDocketEmailSending(undefined, now), false)
})

test('a fresh claim (Date or ISO string) blocks Send', () => {
  assert.equal(isDocketEmailSending(new Date(now - 60_000), now), true)
  assert.equal(isDocketEmailSending(new Date(now - 60_000).toISOString(), now), true)
})

test('a claim older than the stale window is abandoned', () => {
  assert.equal(isDocketEmailSending(new Date(now - DOCKET_EMAIL_SENDING_STALE_MS), now), false)
  assert.equal(isDocketEmailSending(new Date(now - DOCKET_EMAIL_SENDING_STALE_MS - 1), now), false)
})

test('garbage timestamps do not lock the docket', () => {
  assert.equal(isDocketEmailSending('not-a-date', now), false)
})
