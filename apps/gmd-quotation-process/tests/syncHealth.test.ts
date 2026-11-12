import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// @gmd/db-quotation reuses globalThis.quotationPrisma when it is set (same seam as
// pbgData.test.ts), so this fake stands in for the database. Modules are imported
// inside each test, after the fake is in place. No DB and no SMTP.
const upserts: unknown[] = []
let upsertFails = false
;(globalThis as unknown as { quotationPrisma: unknown }).quotationPrisma = {
  engineeringSync: {
    upsert: async (args: unknown) => {
      if (upsertFails) throw new Error('db down')
      upserts.push(args)
    },
  },
}

const H = 3_600_000
const now = new Date('2026-11-10T04:30:00Z') // 10:00 IST, when the alert runs
const ago = (hours: number) => new Date(now.getTime() - hours * H)
const DIR = path.join(import.meta.dirname, '..', 'schedular_function')

test('syncHealthOf: no row is NEVER, 23 h is OK, 25 h is STALE', async () => {
  const { syncHealthOf } = await import('../schedular_function/job-heartbeat.js')
  const health = syncHealthOf(
    [
      { tabKey: 'job:pbg', syncedAt: ago(23) },
      { tabKey: 'job:ledger', syncedAt: ago(25) },
    ],
    ['pbg', 'ledger', 'service-orders'],
    now,
  )
  assert.deepEqual(health, [
    { job: 'pbg', lastRun: ago(23), ageHours: 23, status: 'OK' },
    { job: 'ledger', lastRun: ago(25), ageHours: 25, status: 'STALE' },
    { job: 'service-orders', lastRun: null, ageHours: null, status: 'NEVER' },
  ])
})

test('syncHealthOf ignores unknown jobs and keys without the job: prefix', async () => {
  const { syncHealthOf } = await import('../schedular_function/job-heartbeat.js')
  const health = syncHealthOf(
    [
      { tabKey: 'job:retired-job', syncedAt: ago(1) },
      // The /supply_history label's own heartbeat, written by lib/executionTrackingSync.ts.
      { tabKey: 'execution-tracking', syncedAt: ago(1) },
    ],
    ['execution-tracking'],
    now,
  )
  assert.deepEqual(health, [{ job: 'execution-tracking', lastRun: null, ageHours: null, status: 'NEVER' }])
})

test('alert: no mail when every job is OK or SYNC_ALERT_TO is unset', async () => {
  const { syncHealthAlert } = await import('../schedular_function/sync-health.js')
  const ok = { job: 'pbg', lastRun: ago(1), ageHours: 1, status: 'OK' as const }
  const stale = { job: 'ledger', lastRun: ago(30), ageHours: 30, status: 'STALE' as const }
  assert.equal(syncHealthAlert([ok], 'ops@example.com'), null)
  assert.equal(syncHealthAlert([ok, stale], undefined), null)
  assert.equal(syncHealthAlert([ok, stale], ' , '), null)
})

test('alert: lists the STALE and NEVER jobs, never its own row, to every SYNC_ALERT_TO address', async () => {
  const { syncHealthAlert } = await import('../schedular_function/sync-health.js')
  const mail = syncHealthAlert(
    [
      { job: 'pbg', lastRun: ago(1), ageHours: 1, status: 'OK' },
      { job: 'ledger', lastRun: ago(30), ageHours: 30, status: 'STALE' },
      { job: 'service-orders', lastRun: null, ageHours: null, status: 'NEVER' },
      // Its own last run is ~24 h old whenever it runs; it must not report itself.
      { job: 'sync-health', lastRun: ago(24.1), ageHours: 24.1, status: 'STALE' },
    ],
    'a@example.com, b@example.com',
  )
  assert.ok(mail)
  assert.deepEqual(mail.to, ['a@example.com', 'b@example.com'])
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /ledger: STALE, last successful run .+ IST \(30\.0 h ago\)/)
    assert.match(body, /service-orders: NEVER/)
    assert.doesNotMatch(body, /\bpbg\b|sync-health/)
  }
  assert.match(mail.subject, /2 job/)
})

test('recordJobRun upserts job:<name> with the finish time and the count', async () => {
  const { recordJobRun } = await import('../schedular_function/job-heartbeat.js')
  upserts.length = 0
  const before = Date.now()
  await recordJobRun('pbg', 42)
  assert.equal(upserts.length, 1)
  const { where, create, update } = upserts[0] as {
    where: unknown
    create: { tabKey: string; syncedAt: Date; totalRows: number }
    update: unknown
  }
  assert.deepEqual(where, { tabKey: 'job:pbg' })
  assert.equal(create.tabKey, 'job:pbg')
  assert.equal(create.totalRows, 42)
  assert.ok(create.syncedAt.getTime() >= before)
  assert.deepEqual(update, { syncedAt: create.syncedAt, totalRows: 42 })
})

test('recordJobRun logs a failed write and never throws, so the job still succeeds', async () => {
  const { recordJobRun } = await import('../schedular_function/job-heartbeat.js')
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void logged.push(args)
  upsertFails = true
  try {
    await recordJobRun('ledger')
  } finally {
    upsertFails = false
    console.error = original
  }
  assert.equal(logged.length, 1)
  assert.match(String(logged[0][0]), /ledger.*db down/)
})

test('SYNC_JOBS is exactly the scheduled jobs: every infra conf plus pbg-reminders', async () => {
  const { SYNC_JOBS } = await import('../schedular_function/job-heartbeat.js')
  const confs = fs.readdirSync(path.join(DIR, 'infra')).filter((f) => f.endsWith('.conf')).map((f) => f.slice(0, -'.conf'.length))
  // pbg-reminders is wired from the repo-root infra/ folder instead.
  assert.deepEqual([...SYNC_JOBS].sort(), [...confs, 'pbg-reminders'].sort())
})

test('every runScheduled* runner records its heartbeat', () => {
  const missing = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8')
      return /export async function runScheduled/.test(src) && !/await recordJobRun\(/.test(src)
    })
  assert.deepEqual(missing, [])
})
