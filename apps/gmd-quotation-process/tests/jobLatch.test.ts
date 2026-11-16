import test from 'node:test'
import assert from 'node:assert/strict'
import { JobAlreadyRunningError, runningJobs, withJobLatch } from '../schedular_function/job-latch.js'

test('a second run while the first is in flight is refused and its work never starts', async () => {
  let finish!: () => void
  const first = withJobLatch('test-busy', () => new Promise<string>((resolve) => (finish = () => resolve('first'))))
  let secondRan = false
  await assert.rejects(
    withJobLatch('test-busy', async () => {
      secondRan = true
    }),
    JobAlreadyRunningError,
  )
  assert.equal(secondRan, false)
  // Another job is not blocked by this one.
  assert.equal(await withJobLatch('test-other', async () => 'other'), 'other')

  finish()
  assert.equal(await first, 'first')
  assert.equal(runningJobs.has('test-busy'), false)
  assert.equal(await withJobLatch('test-busy', async () => 'again'), 'again')
})

test('a run that throws still releases the latch, so the next run goes ahead', async () => {
  await assert.rejects(
    withJobLatch('test-throw', async () => {
      throw new Error('sheet unreachable')
    }),
    /sheet unreachable/,
  )
  assert.equal(runningJobs.has('test-throw'), false)
  assert.equal(await withJobLatch('test-throw', async () => 'next'), 'next')
})
