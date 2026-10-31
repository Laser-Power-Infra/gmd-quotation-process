import test from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@gmd/db-quotation'
import { squish } from '../lib/squish.js'
import { buildTableWhere, buildTableOrderBy, type ColumnMap, type TableFilterState } from '../lib/tableQuery.js'

const columns: ColumnMap = { Name: { text: Prisma.sql`"name"` } }
const empty: TableFilterState = { columnFilters: {}, multiFilters: {}, dateFrom: '', dateTo: '', globalSearch: '' }
const HOSTILE = `x'; DROP TABLE "enquiry"; --`

test('unknown header never reaches the SQL text', () => {
  const q = buildTableWhere({ ...empty, columnFilters: { [HOSTILE]: 'a' }, multiFilters: { [HOSTILE]: ['a'] } }, columns)
  assert.equal(q.sql, 'TRUE')
  assert.equal(q.values.length, 0)
})

test('hostile value is a bound parameter, and LIKE wildcards are escaped', () => {
  const BS = String.fromCharCode(92)
  const q = buildTableWhere({ ...empty, columnFilters: { Name: HOSTILE }, globalSearch: `50%_a${BS}b` }, columns)
  assert.ok(!q.sql.includes('DROP'))
  // Search is whitespace- and case-insensitive (squish), so the bound value is squished too.
  assert.ok(q.values.includes(`%${squish(HOSTILE)}%`))
  assert.ok(q.values.includes(`%50${BS}%${BS}_a${BS}${BS}b%`))
})

test('hostile sort header falls back, hostile direction cannot inject', () => {
  const fallback = Prisma.sql`"id" DESC`
  const pk = Prisma.sql`"id"`
  assert.equal(buildTableOrderBy({ header: HOSTILE, direction: 'asc' }, columns, fallback, pk), fallback)
  const q = buildTableOrderBy({ header: 'Name', direction: `asc; DROP TABLE x` as 'asc' }, columns, fallback, pk)
  assert.ok(!q.sql.includes('DROP'))
})
