import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_COLUMN_KEYS, COLUMN_VIEWS, ENQUIRY_COLUMNS, effectiveColumns, matchingView } from '../lib/enquiryColumns.js'
import { DEFAULT_COLUMN_WIDTHS } from '../lib/uiSlice.js'
import { loadColumnSet, saveColumnSet } from '../lib/tablePrefs.js'

const SELECT_COL = 44
const FIT_1366 = 1366 - 20 // viewport minus the vertical scrollbar

const width = (cols: readonly string[]) =>
  SELECT_COL + cols.reduce((sum, k) => sum + DEFAULT_COLUMN_WIDTHS[ALL_COLUMN_KEYS.indexOf(k as never)], 0)

test('every column has a default width, in the same order as the table', () => {
  assert.equal(Object.keys(DEFAULT_COLUMN_WIDTHS).length, ENQUIRY_COLUMNS.length)
})

test('Follow-up and Commercial views fit 1366 px without a horizontal scrollbar', () => {
  assert.ok(width(COLUMN_VIEWS.followUp.columns) <= FIT_1366, String(width(COLUMN_VIEWS.followUp.columns)))
  assert.ok(width(COLUMN_VIEWS.commercial.columns) <= FIT_1366, String(width(COLUMN_VIEWS.commercial.columns)))
})

test('saved views are exactly the sets from the product owner mail (plus the locked Docket and Actions)', () => {
  const set = (cols: readonly string[]) => [...cols].sort()
  assert.deepEqual(set(COLUMN_VIEWS.pricing.columns), set(['docket', 'actions', 'itemName', 'details', 'quantity', 'cost', 'vaPercent', 'validation']))
  assert.deepEqual(set(COLUMN_VIEWS.followUp.columns), set(['docket', 'actions', 'contact', 'status']))
  assert.deepEqual(set(COLUMN_VIEWS.commercial.columns), set(['docket', 'actions', 'terms', 'location']))
  for (const v of Object.values(COLUMN_VIEWS)) assert.ok(v.columns.every((c) => ALL_COLUMN_KEYS.includes(c)))
  assert.equal(matchingView(COLUMN_VIEWS.followUp.columns), 'followUp')
  assert.equal(matchingView(['docket', 'actions']), null)
})

test('saved columns drop unknown keys and ignore junk', () => {
  const store: Record<string, string> = {}
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } } })
  assert.equal(loadColumnSet('k', ALL_COLUMN_KEYS), null)
  saveColumnSet('k', ['docket', 'gone', 'status'])
  assert.deepEqual(loadColumnSet('k', ALL_COLUMN_KEYS), ['docket', 'status'])
  store.k = '{"x":1}'
  assert.equal(loadColumnSet('k', ALL_COLUMN_KEYS), null)
})

test('analytics off shows every column; on keeps the saved view', () => {
  const saved = [...COLUMN_VIEWS.followUp.columns]
  assert.deepEqual(effectiveColumns(false, saved), ALL_COLUMN_KEYS)
  assert.deepEqual(effectiveColumns(true, saved), saved)
})
