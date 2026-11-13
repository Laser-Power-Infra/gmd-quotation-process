import test from 'node:test'
import assert from 'node:assert/strict'
import { BLANK, type TableQuery } from '@gmd/ui/components/data-table/types'
import { readyToBillFacet, readyToBillPage } from '../src/readyToBill'
import type { ContractLine, OfferLine } from '../src/types'

let n = 0
function offer(o: Partial<ContractLine> = {}, qty = 1, rmCodes?: OfferLine['rmCodes']): OfferLine {
  const line: ContractLine = {
    id: `l${++n}`, contractNo: 'C1', party: 'ABC Ltd', poNo: 'PO1', project: null, dateOfContract: '2-May-2024',
    itemCode: 'FSD040050', itemName: 'SLUICE VALVE 65', item: 'SLV', size: '65', pnRating: 'PN - 16', actuator: null,
    rate: 1000, balanceQty: 5, inspection: 'PENDING', offer: 'PENDING', ...o,
  }
  return {
    line, offerableQty: qty, offerValue: qty * line.rate, basis: 'Finished', flags: [], offerSent: false, remarks: null,
    rmCodes: rmCodes ?? [{ erpCode: 'FSD040050', location: 'KGP', qty, spare: false }],
  }
}
const q = (o: Partial<TableQuery> = {}): TableQuery => ({ page: 1, pageSize: 50, sort: null, search: '', filters: {}, ...o })
const contracts = (rows: { contractNo: string }[]) => rows.map((r) => r.contractNo)

test('one row per ready line: stage, ready qty and value, actuator and the stock held', () => {
  const act: OfferLine = {
    ...offer({ contractNo: 'A', actuator: 'K30/RPM24@WDAF87Z50CT6', inspection: 'DONE' }, 2, [
      { erpCode: 'FSD040050', location: 'KGP', qty: 2, spare: false },
      { erpCode: 'RAA010001', location: null, qty: 2, spare: false },
    ]),
    basis: 'Actuator to map',
  }
  const r = readyToBillPage([act, offer({ contractNo: 'B', offer: 'DONE' }), offer({ contractNo: 'C', dateOfContract: 'n/a' })], q())
  assert.deepEqual(r.rows.map((x) => `${x.contractNo}:${x.stage}`), ['A:Inspection done', 'B:Offered', 'C:Not offered'])
  const a = r.rows[0]
  assert.equal(a.readyQty, 2)
  assert.equal(a.readyValue, 2000)
  assert.equal(a.actuator, 'K30/RPM24@WDAF87Z50CT6')
  assert.equal(a.stock, 'FSD040050 @KGP ×2; RAA010001 ×2')
  assert.equal(a.basis, 'With actuator') // the stored "Actuator to map", as shown
  assert.equal(a.date, '2024-05-02') // ISO, so the table sorts and shows it as a date
  assert.equal(r.rows[2].date, null)
})

test('biggest ready value first; sort and paging run over every matching line', () => {
  const lines = [offer({ contractNo: 'S' }, 1), offer({ contractNo: 'L' }, 5), offer({ contractNo: 'M' }, 3)]
  assert.deepEqual(contracts(readyToBillPage(lines, q()).rows), ['L', 'M', 'S'])
  assert.deepEqual(contracts(readyToBillPage(lines, q({ sort: { key: 'readyQty', dir: 'asc' } })).rows), ['S', 'M', 'L'])
  const p2 = readyToBillPage(lines, q({ page: 2, pageSize: 2 }))
  assert.deepEqual(contracts(p2.rows), ['S'])
  assert.equal(p2.total, 3)
  // what the browser sends is not trusted: unknown sort keys keep the default order, page size is capped
  assert.deepEqual(contracts(readyToBillPage(lines, q({ sort: { key: 'id', dir: 'asc' } })).rows), ['L', 'M', 'S'])
  const many = Array.from({ length: 205 }, () => offer())
  assert.equal(readyToBillPage(many, q({ pageSize: 5000 })).rows.length, 200)
})

test('equal ready values keep one order (by line id), whatever order the engine gives', () => {
  const a = offer({ id: 'a', contractNo: 'A' }), b = offer({ id: 'b', contractNo: 'B' })
  assert.deepEqual(contracts(readyToBillPage([b, a], q()).rows), ['A', 'B'])
  assert.deepEqual(contracts(readyToBillPage([a, b], q()).rows), ['A', 'B'])
})

test('a line Offer Now lists at 0 (locked, stock short) is not ready to bill', () => {
  const stuck: OfferLine = { ...offer({ contractNo: 'Z' }, 0), offerSent: true }
  const r = readyToBillPage([offer({ contractNo: 'A' }), stuck], q())
  assert.deepEqual(contracts(r.rows), ['A'])
  assert.equal(r.total, 1)
  assert.equal(r.meta!.contracts, 1)
  assert.deepEqual(readyToBillFacet([stuck], 'contractNo', q()), [])
})

test('search and filters narrow the set; totals cover every matching line, not just the page', () => {
  const lines = [
    offer({ contractNo: 'A1', party: 'Alpha' }, 2),
    offer({ contractNo: 'A2', party: 'Alpha', itemName: 'BUTTERFLY VALVE 200' }, 1),
    offer({ contractNo: 'B1', party: 'Beta', actuator: 'K30/RPM24@WDAF87Z50CT6' }, 4),
  ]
  const alpha = readyToBillPage(lines, q({ filters: { party: ['Alpha'] }, pageSize: 1 }))
  assert.equal(alpha.total, 2)
  assert.equal(alpha.rows.length, 1)
  assert.equal(alpha.meta!.value, 3000)
  assert.equal(alpha.meta!.parties, 1)
  assert.equal(alpha.meta!.contracts, 2)
  // search ignores case and spaces, over every text column
  assert.deepEqual(contracts(readyToBillPage(lines, q({ search: 'butterflyvalve' })).rows), ['A2'])
  assert.deepEqual(contracts(readyToBillPage(lines, q({ search: 'k30/ rpm' })).rows), ['B1'])
  // empty cells are picked as BLANK; a filter on a column that has none is ignored
  assert.deepEqual(contracts(readyToBillPage(lines, q({ filters: { actuator: [BLANK] } })).rows), ['A1', 'A2'])
  assert.equal(readyToBillPage(lines, q({ filters: { readyValue: ['1'] } })).total, 3)
})

test('stage totals ignore the stage filter, so each stage tile keeps its figure', () => {
  const lines = [offer({ contractNo: 'P' }, 1), offer({ contractNo: 'O', offer: 'DONE' }, 2), offer({ contractNo: 'I', inspection: 'DONE' }, 3)]
  const r = readyToBillPage(lines, q({ filters: { stage: ['Offered'] } }))
  assert.deepEqual(contracts(r.rows), ['O'])
  assert.equal(r.meta!.value, 2000)
  assert.deepEqual(r.meta!.stages, {
    'Not offered': { value: 1000, lines: 1 },
    Offered: { value: 2000, lines: 1 },
    'Inspection done': { value: 3000, lines: 1 },
  })
})

test('facets list values under the other filters, never their own', () => {
  const lines = [offer({ contractNo: 'A1', party: 'Alpha', project: 'P1' }), offer({ contractNo: 'B1', party: 'Beta' })]
  const picked = q({ filters: { party: ['Alpha'] } })
  assert.deepEqual(readyToBillFacet(lines, 'party', picked), ['Alpha', 'Beta'])
  assert.deepEqual(readyToBillFacet(lines, 'contractNo', picked), ['A1'])
  assert.deepEqual(readyToBillFacet(lines, 'project', q()), [BLANK, 'P1'].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(readyToBillFacet(lines, 'readyValue', q()), []) // not a filter column
})
