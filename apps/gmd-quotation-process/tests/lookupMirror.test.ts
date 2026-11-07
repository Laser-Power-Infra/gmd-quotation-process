import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMirrorPayload } from '../lib/lookupMirrorPayload.js'

test('buildMirrorPayload shapes rows with ISO dates and passes delete ids', () => {
  const d = new Date('2026-01-02T03:04:05.000Z')
  const out = buildMirrorPayload(
    [{ id: 'a', type: 'T', value: 'v', sortOrder: 2, isActive: true, code: null, defaultState: null, createdAt: d, updatedAt: d }],
    ['x', 'y'],
  )
  assert.deepEqual(out, {
    upsert: [{ id: 'a', type: 'T', value: 'v', sortOrder: 2, isActive: true, code: null, defaultState: null,
      createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z' }],
    delete: ['x', 'y'],
  })
})
