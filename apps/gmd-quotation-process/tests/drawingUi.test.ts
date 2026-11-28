import test from 'node:test'
import assert from 'node:assert/strict'
import reducer, {
  clearFilters,
  queryOf,
  selectDrawingsTable,
  setColumnSearch,
  setFilter,
  setMode,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from '@gmd/drawings/state'
import { DRAWING_STATUSES, daysAtStage, movesFor } from '@gmd/drawings/columns'

// The Drawings page's query state, and the two rules the contract window reads: which next statuses
// a role is offered (with what each move needs) and how many days a drawing has sat at its stage.

const start = () => reducer(undefined, { type: 'init' })
const onPage3 = () => reducer(start(), setPage(3))

test('the Drawings page starts on page 1 of all rows, nothing filtered', () => {
  const s = start()
  assert.deepEqual(queryOf(s), { page: 1, pageSize: 50, sort: null, search: '', filters: {}, columnSearch: {}, extra: { pending: false } })
  assert.equal(selectDrawingsTable({ drawingsTable: s }), s)
})

test('a filter, column search, search, sort, page size or mode change goes back to page 1', () => {
  const changes = [
    setFilter({ key: 'status', values: ['Draft prepared'] }),
    setColumnSearch({ key: 'client', value: 'kalpa' }),
    setSearch('GMDSPL'),
    setSort({ key: 'daysAtStage', dir: 'desc' }),
    setPageSize(100),
    setMode('pending'),
  ]
  for (const change of changes) assert.equal(reducer(onPage3(), change).page, 1, change.type)
  // Paging itself keeps the filters.
  const filtered = reducer(start(), setFilter({ key: 'owner', values: ['Washim'] }))
  assert.deepEqual(reducer(filtered, setPage(2)).filters, { owner: ['Washim'] })
})

test('the All / Pending toggle reaches the server query', () => {
  const pending = reducer(start(), setMode('pending'))
  assert.equal(pending.mode, 'pending')
  assert.deepEqual(queryOf(pending).extra, { pending: true })
  assert.deepEqual(queryOf(reducer(pending, setMode('all'))).extra, { pending: false })
})

test('sort, search, filters and column search round-trip into the query; an empty pick drops its key', () => {
  let s = start()
  s = reducer(s, setSort({ key: 'daysAtStage', dir: 'desc' }))
  s = reducer(s, setSearch('GMDSPL-2611'))
  s = reducer(s, setFilter({ key: 'status', values: ['Sent to client', '(Blank)'] }))
  s = reducer(s, setColumnSearch({ key: 'client', value: '  kalpa  ' }))
  const q = queryOf(s)
  assert.deepEqual(q.sort, { key: 'daysAtStage', dir: 'desc' })
  assert.equal(q.search, 'GMDSPL-2611')
  assert.deepEqual(q.filters, { status: ['Sent to client', '(Blank)'] })
  assert.deepEqual(q.columnSearch, { client: 'kalpa' })

  s = reducer(s, setFilter({ key: 'status', values: [] }))
  s = reducer(s, setColumnSearch({ key: 'client', value: ' ' }))
  s = reducer(s, setSort(null))
  assert.deepEqual(queryOf(s).filters, {})
  assert.deepEqual(queryOf(s).columnSearch, {})
  assert.equal(queryOf(s).sort, null)
})

test('Clear all drops every filter and the search, and keeps the All / Pending view, sort and page size', () => {
  let s = start()
  s = reducer(s, setSort({ key: 'contractNo', dir: 'asc' }))
  s = reducer(s, setPageSize(25))
  s = reducer(s, setFilter({ key: 'docType', values: ['QAP'] }))
  s = reducer(s, setColumnSearch({ key: 'contractor', value: 'skylark' }))
  s = reducer(s, setSearch('42009843'))
  s = reducer(s, setMode('pending'))
  s = reducer(s, setPage(4))
  assert.deepEqual(queryOf(reducer(s, clearFilters())), {
    page: 1,
    pageSize: 25,
    sort: { key: 'contractNo', dir: 'asc' },
    search: '',
    filters: {},
    columnSearch: {},
    // The view is a tab, not a filter: Clear never switches it.
    extra: { pending: true },
  })
})

test("the window's status control offers each role exactly its rows of the move table, in flow order, with what each move needs", () => {
  const EDIT = ['editor', 'verifier']
  // Puja 18 Nov 2026: [from, to, roles, needs]. Washim (verifier) alone verifies or sends back.
  const TABLE: [string, string, string[], string?][] = [
    ['Draft prepared', 'Sent to Washim for verification', EDIT],
    ['Draft prepared', 'Verified by Washim', ['verifier']],
    ['Sent to Washim for verification', 'Correction required', ['verifier'], 'comment'],
    ['Sent to Washim for verification', 'Verified by Washim', ['verifier']],
    ['Correction required', 'Draft prepared', EDIT],
    ['Verified by Washim', 'Correction required', ['verifier'], 'comment'],
    ['Verified by Washim', 'Sent to client', EDIT],
    ['Sent to client', 'Client comments received', EDIT, 'comment-or-file'],
    ['Sent to client', 'Approved by client', EDIT, 'pdf'],
    ['Client comments received', 'Approved by client', EDIT, 'pdf'],
  ]
  for (const status of DRAWING_STATUSES) {
    for (const role of ['verifier', 'editor', 'viewer'] as const) {
      const expected = TABLE.filter(([from, , roles]) => from === status && roles.includes(role)).map(([, to, , needs]) => ({ to, needs }))
      const offered = movesFor(status, role).map((m) => ({ to: m.to, needs: m.needs }))
      assert.deepEqual(offered, expected, `${role} at "${status}"`)
    }
  }
})

test('days at this stage count India calendar days, as the Drawings page does', () => {
  // 19 Nov 23:59 IST -> 20 Nov 00:01 IST is one day, though only two minutes passed.
  assert.equal(daysAtStage('2026-11-19T18:29:00.000Z', new Date('2026-11-19T18:31:00.000Z')), 1)
  // Same India day, hours apart in UTC.
  assert.equal(daysAtStage('2026-11-19T18:31:00.000Z', new Date('2026-11-20T18:00:00.000Z')), 0)
  assert.equal(daysAtStage('2026-11-01T06:00:00.000Z', new Date('2026-11-20T06:00:00.000Z')), 19)
})

const pdf = (name: string, mb: number) => ({ name, size: mb * 1024 * 1024 })

test('checkPdfs names the limit that is exceeded: count, type, one file, total', async () => {
  const { checkPdfs, MAX_PDF_BYTES } = await import('@gmd/drawings/columns')
  const { MAX_UPLOAD_BYTES } = await import('../lib/uploadChecks.js')
  assert.equal(MAX_PDF_BYTES, MAX_UPLOAD_BYTES, 'client and server cap agree')
  assert.equal(checkPdfs([]), null)
  assert.equal(checkPdfs([pdf('a.PDF', 25)]), null)
  assert.match(checkPdfs(Array.from({ length: 11 }, (_, i) => pdf(`${i}.pdf`, 1)))!, /at most 10/)
  assert.match(checkPdfs([pdf('a.docx', 1)])!, /not a PDF/)
  assert.match(checkPdfs([pdf('big.pdf', 26)])!, /25 MB or less/)
  assert.match(checkPdfs(Array.from({ length: 4 }, (_, i) => pdf(`${i}.pdf`, 24)))!, /95 MB/)
})
