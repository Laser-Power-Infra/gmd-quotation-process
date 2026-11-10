import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTable, facetValues } from '../src/ui/localTable'
import { BLANK, type DataColumn } from '@gmd/ui/components/data-table/types'

type R = { id: string; party: string; qty: number; date: string }
const rows: R[] = [
  { id: 'a', party: 'ABC', qty: 10, date: '2-May-2024' },
  { id: 'b', party: '', qty: 2, date: '12-Nov-2023' },
  { id: 'c', party: 'XYZ', qty: 100, date: '1-Jan-2025' },
]
const cols: DataColumn<R>[] = [
  { key: 'party', label: 'Party', kind: 'text' },
  { key: 'qty', label: 'Qty', kind: 'number' },
  { key: 'date', label: 'Date', kind: 'date' },
]
const ids = (rs: R[]) => rs.map((r) => r.id).join('')

test('numbers and dates sort by value, not text', () => {
  assert.equal(ids(applyTable(rows, cols, { key: 'qty', dir: 'asc' }, {})), 'bac')
  assert.equal(ids(applyTable(rows, cols, { key: 'date', dir: 'desc' }, {})), 'cab')
  assert.equal(ids(applyTable(rows, cols, null, {})), 'abc')
})

test('facet filters match values and blanks', () => {
  assert.deepEqual(facetValues(rows, 'party'), [BLANK, 'ABC', 'XYZ'].sort((a, b) => a.localeCompare(b)))
  assert.equal(ids(applyTable(rows, cols, null, { party: ['XYZ', BLANK] })), 'bc')
  assert.equal(ids(applyTable(rows, cols, null, { party: [] })), 'abc')
})
