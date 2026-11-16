import test from 'node:test'
import assert from 'node:assert/strict'
import { runLedgerSync, type LedgerSyncDeps, type LedgerWriter } from '../schedular_function/ledger-sync.js'
import { DEBTORS_GID, DEBTORS_HEADERS } from '../lib/debtorsSync.js'
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
    readByGid: async (g) =>
      g === DEBTORS_GID ? { tabTitle: 'DEBTORS', headers: f.dH, rows: [f.dRow, f.dRow] }
      : g === CREDITORS_GID ? { headers: f.cH, rows: [f.cRow] }
      : g === ADVANCES_GID ? { headers: f.aH, rows: [f.aRow] }
      : Promise.reject(new Error(`No tab with gid ${g}`)),
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
  const base = deps().d
  const { d, writes } = deps({
    readByGid: async (g) => (g === CREDITORS_GID ? Promise.reject(new Error(`No tab with gid ${g}`)) : base.readByGid(g)),
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
    readByGid: async (g) =>
      g === CREDITORS_GID ? { headers: f.cH.map((h, i) => (i === 1 ? 'RENAMED' : h)), rows: [f.cRow] }
      : { headers: f.aH, rows: [f.aRow] },
  })
  const report = await runLedgerSync({ deps: d })
  assert.ok(report.creditors.error)
  assert.equal(writes.creditors.length, 0)
})

// An emptied tab or a changed date format must not replace a ledger with almost nothing.
const f = fixture()
const badDate = fill(f.dH, { [DEBTORS_HEADERS.accCode]: 'D2', [DEBTORS_HEADERS.vrDate]: '05/11/2026' })
function withDebtorRows(rows: string[][]) {
  const base = deps().d
  return deps({ readByGid: async (g) => (g === DEBTORS_GID ? { tabTitle: 'DEBTORS', headers: f.dH, rows } : base.readByGid(g)) })
}

test('a header-only tab is refused and its table left as it was', async () => {
  const { d, writes } = withDebtorRows([])
  const report = await runLedgerSync({ deps: d })
  assert.match(report.debtors.error ?? '', /0 of 0 rows readable/)
  assert.equal(writes.debtors.length, 0)
  assert.equal(report.creditors.written, 1) // the other ledgers still sync
})

test('more unreadable rows than readable ones is refused', async () => {
  const { d, writes } = withDebtorRows([f.dRow, badDate, badDate])
  const report = await runLedgerSync({ deps: d })
  assert.match(report.debtors.error ?? '', /1 of 3 rows readable.*DD-MM-YYYY/)
  assert.equal(writes.debtors.length, 0)
})

test('a few unreadable rows still replace the table', async () => {
  const { d, writes } = withDebtorRows([f.dRow, f.dRow, f.dRow, badDate])
  const report = await runLedgerSync({ deps: d })
  assert.equal(report.debtors.error, undefined)
  assert.equal(report.debtors.skipped, 1)
  assert.equal(writes.debtors[0]?.length, 3)
})
