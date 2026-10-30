import test from 'node:test'
import assert from 'node:assert/strict'
import { ageBucket, istDaysSince, STAGE_ASSIGNEE_FIELD } from '../lib/stageAgeing.js'

test('ageBucket edges', () => {
  assert.equal(ageBucket(0), '0-2')
  assert.equal(ageBucket(2), '0-2')
  assert.equal(ageBucket(3), '3-7')
  assert.equal(ageBucket(7), '3-7')
  assert.equal(ageBucket(8), '8-15')
  assert.equal(ageBucket(15), '8-15')
  assert.equal(ageBucket(16), '16+')
  // Future-dated enquiry (typo) still lands in the youngest bucket.
  assert.equal(ageBucket(-1), '0-2')
})

test('istDaysSince counts IST calendar days, not 24h blocks', () => {
  const now = new Date('2026-10-15T00:10:00+05:30')
  // 23:50 IST yesterday is one IST day ago even though only 20 minutes passed.
  assert.equal(istDaysSince(new Date('2026-10-14T23:50:00+05:30'), now), 1)
  // 00:05 IST today is the same IST day although it is the previous UTC day.
  assert.equal(istDaysSince(new Date('2026-10-15T00:05:00+05:30'), now), 0)
  assert.equal(istDaysSince(new Date('2026-10-10T12:00:00+05:30'), now), 5)
  assert.equal(istDaysSince('2026-10-10T12:00:00+05:30', now), 5)
})

test('every open stage has an assignee column; sent has none', () => {
  assert.deepEqual(STAGE_ASSIGNEE_FIELD, {
    details: 'detailsAssigneeId',
    cost: 'costAssigneeId',
    validation: 'validationAssigneeId',
    ready: 'sendAssigneeId',
  })
})
