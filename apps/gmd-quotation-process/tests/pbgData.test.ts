import test from 'node:test'
import assert from 'node:assert/strict'

// @gmd/db-quotation reuses globalThis.quotationPrisma when it is set, so this
// fake stands in for the database. pbg-data is imported inside each test, after
// the fake is in place. No DB and no network.
const db = {
  pbgRows: [] as Record<string, unknown>[],
  supplyRows: [] as Record<string, unknown>[],
  calls: [] as { op: string; args: unknown }[],
}
const log = (op: string, result?: unknown) => async (args: unknown) => {
  db.calls.push({ op, args })
  return result
}
;(globalThis as unknown as { quotationPrisma: unknown }).quotationPrisma = {
  pbgData: {
    findMany: async () => db.pbgRows,
    create: log('create'),
    update: log('update'),
    updateMany: log('updateMany'),
  },
  supplyHistoryItem: {
    findMany: async (args: unknown) => {
      db.calls.push({ op: 'supply', args })
      return db.supplyRows
    },
  },
}

// One canned body answers the OAuth token, tab-title and sheet-values requests.
let sheet: string[][] = []
process.env.GOOGLE_CLIENT_ID ||= 'test'
process.env.GOOGLE_CLIENT_SECRET ||= 'test'
process.env.GOOGLE_REFRESH_TOKEN ||= 'test'
globalThis.fetch = (async () =>
  Response.json({ access_token: 't', expires_in: 3600, values: sheet })) as typeof fetch

const decimal = (n: number) => ({ toString: () => String(n) })

const pbgRow = (over: Record<string, unknown>) => ({
  id: BigInt(0), clientName: null, project: null, poNumber: null, poDate: null,
  bgNo: null, bgDate: null, bgAmtFc: null, expiryDate: null, claimDate: null,
  marginPct: null, marginAmount: null, contactPerson: null, contactNumber: null,
  remark: null, status: null, mailTrigger: null, bankGuarantee: null,
  validityOn: null, syncedAt: null, updatedAt: null,
  ...over,
})

test('sync stamps syncedAt on unchanged rows in one call and leaves updatedAt alone', async () => {
  const { syncPbgData } = await import('../lib/pbg/pbg-data.js')
  sheet = [
    ['BG_NO', 'BENEFICIARY_NAME', 'BG_AMT', 'CANCELLED_STATUS'],
    ['BG-1', 'Alpha', '100', 'Running'], // unchanged
    ['BG-2', 'Beta', '250', 'Running'], // amount changed
    ['BG-3', 'Gamma', '300', 'OPEN'], // new
  ]
  db.pbgRows = [
    { id: BigInt(1), bgNo: 'BG-1', clientName: 'Alpha', bgAmtFc: decimal(100), marginPct: null, marginAmount: null, status: 'Running' },
    { id: BigInt(2), bgNo: 'BG-2', clientName: 'Beta', bgAmtFc: decimal(200), marginPct: null, marginAmount: null, status: 'Running' },
  ]
  db.calls = []

  const result = await syncPbgData()

  assert.deepEqual([result.inserted, result.updated, result.unchanged], [1, 1, 1])
  const stamps = db.calls.filter((call) => call.op === 'updateMany')
  assert.equal(stamps.length, 1)
  const { where, data } = stamps[0].args as { where: unknown; data: Record<string, unknown> }
  assert.deepEqual(where, { id: { in: [BigInt(1)] } })
  assert.deepEqual(Object.keys(data), ['syncedAt'])
  assert.ok(data.syncedAt instanceof Date)
})

test('sync makes no stamp call when no row is unchanged', async () => {
  const { syncPbgData } = await import('../lib/pbg/pbg-data.js')
  sheet = [['BG_NO', 'BENEFICIARY_NAME'], ['BG-9', 'New Co']]
  db.pbgRows = []
  db.calls = []

  await syncPbgData()

  assert.equal(db.calls.filter((call) => call.op === 'updateMany').length, 0)
})

test('dashboard shows RUNNING/CLOSED, drops closed rows before the supply lookup, and carries the contract no', async () => {
  const { getPbgData } = await import('../lib/pbg/pbg-data.js')
  db.pbgRows = [
    pbgRow({ id: BigInt(1), bgNo: 'BG-O', poNumber: 'PO-1', status: 'Expired' }),
    pbgRow({ id: BigInt(2), bgNo: 'BG-C', poNumber: 'PO-2', status: 'Returned' }),
  ]
  db.supplyRows = [
    { partyOrderNo: 'PO-1', bgNo: 'BG-O', date: '15-Sep-25', invoiceNo: 'GD25Y-00001', partyDate: null, orderList: null, erpContractNo: 'S125Y-00042' },
  ]
  db.calls = []

  const rows = await getPbgData()

  assert.deepEqual(rows.map((row) => [row.bgNo, row.status, row.contractNo]), [['BG-O', 'RUNNING', 'S125Y-00042']])
  const lookup = JSON.stringify(db.calls.find((call) => call.op === 'supply')?.args)
  assert.ok(lookup.includes('BG-O') && !lookup.includes('BG-C'), lookup)

  const all = await getPbgData({ includeClosed: true })
  assert.deepEqual(all.map((row) => row.status), ['RUNNING', 'CLOSED'])
})
