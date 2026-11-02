import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSupplyOrderBy, buildSupplyWhere, type SupplyQuery } from '../lib/supplyQuery.js'
import { EMPTY_DATE_PRESET } from '../lib/supplyDatePreset.js'

const filters = (batchFilters: Record<string, boolean> = {}): SupplyQuery['filters'] => ({
  columnFilters: {},
  multiFilters: {},
  batchFilters,
  ...EMPTY_DATE_PRESET,
  dateFrom: '',
  dateTo: '',
  globalSearch: '',
  currentPage: 1,
  pageSize: 25,
})

test('default order is latest invoice date first', () => {
  const { sql } = buildSupplyOrderBy({ filters: filters(), sort: null })
  assert.ok(sql.includes('DESC NULLS LAST'))
  assert.ok(!sql.includes('syncedAt'))
})

test('noBom batch filter adds a NOT EXISTS predicate', () => {
  const { sql } = buildSupplyWhere({ filters: filters({ noBom: true }), sort: null })
  assert.ok(sql.includes('NOT EXISTS'))
})
