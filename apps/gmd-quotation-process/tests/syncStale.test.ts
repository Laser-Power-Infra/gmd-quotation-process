import test from 'node:test'
import assert from 'node:assert/strict'
import { isSyncStale } from '@gmd/dashboard/lib/syncStale'

const now = Date.parse('2026-01-02T12:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()
const H = 3_600_000

test('isSyncStale', () => {
  assert.equal(isSyncStale(undefined, now), false)
  assert.equal(isSyncStale(null, now), true)
  assert.equal(isSyncStale('garbage', now), true)
  assert.equal(isSyncStale(ago(24 * H - 60_000), now), false)
  assert.equal(isSyncStale(ago(24 * H + 60_000), now), true)
  assert.equal(isSyncStale(new Date(now - 25 * H), now), true)
  assert.equal(isSyncStale(new Date(now - H), now), false)
})
