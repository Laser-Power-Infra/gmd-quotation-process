import test from 'node:test'
import assert from 'node:assert/strict'
import { runLedgerSync, type LedgerSyncDeps, type LedgerWriter } from '../schedular_function/ledger-sync.js'
import { DEBTORS_HEADERS, DEBTORS_GID } from '../lib/debtorsSync.js'
import { CREDITOR_HEADERS, ADVANCE_HEADERS, CREDITORS_GID, ADVANCES_GID } from '../lib/creditorsSync.js'


// Rows are built from the real header lists; blank ACC_CODE rows are skipped, so
// fill every cell with something mappable per column name instead.
function fill(headers: string[], over: Record<string, string>) {
  return headers.map((h) => over[h] ?? '')
}

function fixture() {
  const dH = Object.values(DEBTORS_HEADERS)
  const cH = Object.values(CREDITOR_HEADERS)
  const aH = Object.values(ADVANCE_HEADERS)
  const dRow = fill(dH, { [DEBTORS_HEADERS.accCode]: 'D1', [DEBTORS_HEADERS.accName]: 'DEBT CO', [DEBTORS_HEADERS.unAllocDr]: '100' })
  const cRow = fill(cH, { [CREDITOR_HEADERS.accCode]: 'C1', [CREDITOR_HEADERS.accName]: 'CRED CO', [CREDITOR_HEADERS.unAllocCr]: '50' })
  const aRow = fill(aH, { [ADVANCE_HEADERS.accCode]: 'C1', [ADVANCE_HEADERS.unAllocDr]: '5' })
  return { dH, cH, aH, dRow, cRow, aRow }
}

function writer<T>(store: T[][]): LedgerWriter<T> {
  return { count: async () => 0, replace: async (r) => { store.push(r) } }
}

function deps(over: Partial<LedgerSyncDeps> = {}) {
  const f = fixture()
  const writes = { debtors: [] as unknown[][], creditors: [] as unknown[][], advances: [] as unknown[][] }
  const d: LedgerSyncDeps = {
    readByGid: async (gid) =>
      gid === DEBTORS_GID ? { tabTitle: 'DEBTORS', headers: f.dH, rows: [f.dRow, f.dRow] }
      : gid === CREDITORS_GID ? { headers: f.cH, rows: [f.cRow] }
      : { headers: f.aH, rows: [f.aRow] },
    debtors: writer(writes.debtors as never[][]),
    creditors: writer(writes.creditors as never[][]),
    advances: writer(writes.advances as never[][]),
    ...over,
  }
  return { d, writes }
}


test('dry run writes nothing and still reports counts', async () => {
  const { d, writes } = deps()
  const report = await runLedgerSync({ dryRun: true, deps: d })
  assert.equal(report.debtors.written, 0)
  assert.ok(report.debtors.mapped > 0)
  assert.equal(report.creditors.mapped, 1)
  assert.equal(report.advances.mapped, 1)
  assert.equal(writes.debtors.length + writes.creditors.length + writes.advances.length, 0)
})

test('a failed creditors tab does not abandon a good debtors sync', async () => {
  const f = fixture()
  const { d, writes } = deps({
    readByGid: async (gid) => {
      if (gid === CREDITORS_GID) throw new Error(`No tab with gid ${gid} in spreadsheet X`)
      return gid === DEBTORS_GID
        ? { tabTitle: 'DEBTORS', headers: f.dH, rows: [f.dRow, f.dRow] }
        : { headers: f.aH, rows: [f.aRow] }
    },
  })
  const report = await runLedgerSync({ deps: d })
  assert.ok(report.debtors.written > 0)
  assert.equal(report.debtors.error, undefined)
  assert.match(report.creditors.error ?? '', /No tab with gid/)
  assert.equal(report.creditors.written, 0)
  assert.equal(writes.creditors.length, 0) // untouched, not emptied
  assert.equal(report.advances.written, 1) // the other ledger is independent
})

test('a renamed creditors column fails loudly and writes nothing', async () => {
  const f = fixture()
  const { d, writes } = deps({
    readByGid: async (gid) =>
      gid === CREDITORS_GID ? { headers: f.cH.map((h, i) => (i === 1 ? 'RENAMED' : h)), rows: [f.cRow] }
      : gid === DEBTORS_GID ? { tabTitle: 'DEBTORS', headers: f.dH, rows: [f.dRow, f.dRow] }
      : { headers: f.aH, rows: [f.aRow] },
  })
  const report = await runLedgerSync({ deps: d })
  assert.ok(report.creditors.error)
  assert.equal(writes.creditors.length, 0)
})
