import test from 'node:test'
import assert from 'node:assert/strict'
import { decideClosureStatus } from '../lib/closureStatusSync.js'

test('blank with no referencing thread becomes Pending', () => {
  assert.equal(decideClosureStatus(null, false, false), 'Pending')
  assert.equal(decideClosureStatus('  ', false, false), 'Pending')
})

test('blank referenced without evidence is left alone', () => {
  assert.equal(decideClosureStatus(null, false, true), null)
})

test('mail evidence upgrades blank, Pending and Not Sent to Sent', () => {
  assert.equal(decideClosureStatus(null, true, true), 'Sent')
  assert.equal(decideClosureStatus('Pending', true, true), 'Sent')
  assert.equal(decideClosureStatus(' pending ', true, false), 'Sent')
  assert.equal(decideClosureStatus('Not Sent', true, true), 'Sent')
  assert.equal(decideClosureStatus('NOT SENT', true, true), 'Sent')
})

test('Not Sent is never overwritten with Pending', () => {
  assert.equal(decideClosureStatus('Not Sent', false, false), null)
  assert.equal(decideClosureStatus('Not Sent', false, true), null)
})

test('Rejected, Sent and other manual values never change', () => {
  assert.equal(decideClosureStatus('Rejected', true, true), null)
  assert.equal(decideClosureStatus('Sent', true, true), null)
  assert.equal(decideClosureStatus('Sent', false, false), null)
  assert.equal(decideClosureStatus('Pending', false, false), null)
  assert.equal(decideClosureStatus('PO Received', true, true), null)
})
