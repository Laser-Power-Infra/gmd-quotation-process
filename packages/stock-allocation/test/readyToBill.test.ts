import test from 'node:test'
import assert from 'node:assert/strict'
import { BLANK, type TableQuery } from '@gmd/ui/components/data-table/types'
import { toCsv } from '@gmd/ui/lib/csv'
import { allocateStock } from '../src/engine'
import { inspectionCallList, READY_COLUMNS, readyToBillExport, readyToBillFacet, readyToBillPage, SHARE_HEADER } from '../src/readyToBill'
import type { ContractLine, LedgerEntry, LineAllocation, OfferLine, StockItem } from '../src/types'

let n = 0
const contractLine = (o: Partial<ContractLine> = {}): ContractLine => ({
  id: `l${++n}`, contractNo: 'C1', party: 'ABC Ltd', poNo: 'PO1', project: null, dateOfContract: '2-May-2024',
  itemCode: 'FSD040050', itemName: 'SLUICE VALVE 65', item: 'SLV', size: '65', pnRating: 'PN - 16', actuator: null,
  rate: 1000, balanceQty: 5, inspection: 'PENDING', offer: 'PENDING', ...o,
})
function offer(o: Partial<ContractLine> = {}, qty = 1, rmCodes?: OfferLine['rmCodes']): OfferLine {
  const line = contractLine(o)
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

// 18 Nov: each row carries the engine's per-line result (lines[]), and Ready to Bill gives the "Ready for inspection call" list.

const READY = 'Ready for inspection call', WIRING = 'Allocated - wiring change required'
/** The engine's per-line result for an Offer Now line: what a test sets, the rest a fully held ready line. */
const alloc = (o: OfferLine, a: Partial<LineAllocation> = {}): LineAllocation => ({
  id: o.line.id, balanceToOffer: o.offerableQty, fgQty: o.offerableQty, rmRouteQty: 0, incomingQty: 0, eta: null, shortfall: 0,
  status: READY, actuatorFree: null, gbFree: null, flags: [], sources: [], suggestions: [], ...a,
})

test('a row carries its line allocation: MC no, balance to offer, incoming with ETA, shortfall, status as the engine words it', () => {
  const a = offer({ contractNo: 'A', mcNo: 'OD26Y-00052' }, 3), b = offer({ contractNo: 'B' }, 2), c = offer({ contractNo: 'C' }, 1)
  const lines = [
    alloc(a, { balanceToOffer: 2, incomingQty: 4, eta: '12-Dec-2026', shortfall: 1, status: 'Partial' }),
    alloc(b, { incomingQty: 3, eta: 'end of Jan' }), // an ETA that is not a date stays as written
  ]
  const [x, y, z] = readyToBillPage([a, b, c], q(), lines).rows
  assert.deepEqual([x.mcNo, x.balanceToOffer, x.incomingQty, x.eta, x.shortfall, x.allocStatus], ['OD26Y-00052', 2, 4, '2026-12-12', 1, 'Partial'])
  assert.deepEqual([y.incomingQty, y.eta, y.allocStatus], [3, 'end of Jan', READY])
  // no allocation for the line: blank cells, never a made-up 0 or status; no incoming shows blank too
  assert.deepEqual([z.mcNo, z.balanceToOffer, z.incomingQty, z.eta, z.shortfall, z.allocStatus], [null, null, null, null, null, null])
  assert.equal(readyToBillPage([a], q(), [alloc(a)]).rows[0].incomingQty, null)
})

test('Ready for inspection call tile: counted on the server under every other filter; wiring change has its own count; MC pending and Blue Star never', () => {
  const slv = (o: Partial<StockItem> = {}): StockItem => ({
    id: `s${++n}`, erpCode: 'FSD040050', location: 'KGP', valveType: 'SLUICE VALVE', dimension: '65MM', component: 'HW OP',
    material: 'DUCTILE IRON', std: 'STD', pn: 'PN-16', category: 'FINISHED VALVES', itemType: 'FINISHED / COMPLETE VALVE', availableQty: 10, ...o,
  })
  // the approved actuator model and RPM, other wiring: usable only with a wiring change
  const act = slv({ erpCode: 'RAA010002', valveType: 'ACTUATOR', dimension: null, component: null, material: null, pn: 'K30/RPM24', std: 'WDXX0000', category: 'ACTUATORS', itemType: null })
  const mk = (id: string, o: Partial<ContractLine>) => contractLine({ id, contractNo: id, balanceQty: 1, ...o })
  const lines = [
    mk('R1', { party: 'Alpha', balanceQty: 2 }), mk('R2', { party: 'Beta' }),
    mk('W', { party: 'Alpha', actuator: 'K30/RPM24@WDAF87Z50CT6' }),
    mk('P', { party: 'Alpha', mcPending: true }), // MC pending; "Offer sent" locked its stock, so Offer Now still lists it
    mk('B', { party: 'BLUE STAR LIMITED', inspection: 'DONE' }), // keeps the stock it already had inspected
  ]
  const lock: LedgerEntry = {
    id: 'g1', erpCode: 'FSD040050', location: 'KGP', contractNo: 'P', itemCode: 'FSD040050', qty: 1, source: 'locked', basis: 'Finished',
    remarks: null, allocatedAt: '2026-11-01T00:00:00Z',
  }
  const res = allocateStock({ stock: [slv(), act], lines, ledger: [lock] })
  const page = (o: Partial<TableQuery> = {}) => readyToBillPage(res.offerNow, q(o), res.lines)
  const all = page()
  // with no tile picked the table shows every line the engine has offerable stock for, each with its status
  assert.deepEqual(Object.fromEntries(all.rows.map((r) => [r.contractNo, r.allocStatus])), {
    R1: READY, R2: READY, W: WIRING, P: 'MC pending - stock held', B: 'Blue Star - left out for now',
  })
  assert.deepEqual(all.meta!.calls, { [READY]: { value: 3000, lines: 2 }, [WIRING]: { value: 1000, lines: 1 } })
  // the tile filters the table to its lines and keeps its figure; the figures follow every other filter and the search
  const picked = page({ filters: { allocStatus: [READY] } })
  assert.deepEqual(contracts(picked.rows).sort(), ['R1', 'R2'])
  assert.equal(picked.total, 2)
  assert.deepEqual(picked.meta!.calls, all.meta!.calls)
  assert.deepEqual(page({ filters: { party: ['Alpha'] } }).meta!.calls[READY], { value: 2000, lines: 1 })
  assert.equal(page({ search: 'beta' }).meta!.calls[READY].lines, 1)
  assert.deepEqual(contracts(page({ filters: { allocStatus: [WIRING] } }).rows), ['W'])
  // the list for sharing takes the same ready lines only: no wiring change, MC pending or Blue Star
  assert.deepEqual(inspectionCallList(res.offerNow, q(), res.lines).map((r) => r[1]), ['R1', 'R2'])
})

test('the new columns sort, filter, search and facet on the server like the others', () => {
  const a = offer({ contractNo: 'A', mcNo: 'MC-2' }, 1), b = offer({ contractNo: 'B', mcNo: 'MC-1' }, 2), c = offer({ contractNo: 'C' }, 3)
  const lines = [
    alloc(a, { balanceToOffer: 5, shortfall: 4, incomingQty: 2, eta: '1-Jan-2027', status: 'Partial' }),
    alloc(b, { balanceToOffer: 2 }),
    alloc(c, { balanceToOffer: 3, shortfall: 1, incomingQty: 6, eta: '15-Dec-2026', status: 'Partial' }),
  ]
  const page = (o: Partial<TableQuery>) => contracts(readyToBillPage([a, b, c], q(o), lines).rows)
  const sorted = (key: string, dir: 'asc' | 'desc') => page({ sort: { key, dir } })
  assert.deepEqual(sorted('balanceToOffer', 'asc'), ['B', 'C', 'A'])
  assert.deepEqual(sorted('shortfall', 'desc'), ['A', 'C', 'B'])
  assert.deepEqual(sorted('incomingQty', 'desc'), ['C', 'A', 'B'])
  assert.deepEqual(sorted('eta', 'asc'), ['B', 'C', 'A'])
  assert.deepEqual(sorted('mcNo', 'asc'), ['C', 'B', 'A'])
  assert.deepEqual(sorted('allocStatus', 'desc'), ['B', 'C', 'A'])
  assert.deepEqual(page({ filters: { allocStatus: ['Partial'] } }), ['C', 'A'])
  assert.deepEqual(page({ filters: { mcNo: [BLANK] } }), ['C'])
  assert.deepEqual(page({ search: 'mc-1' }), ['B'])
  assert.deepEqual(page({ search: 'ready for inspection' }), ['B'])
  const partial = q({ filters: { allocStatus: ['Partial'] } })
  assert.deepEqual(readyToBillFacet([a, b, c], 'allocStatus', partial, lines), ['Partial', READY]) // never its own filter
  assert.deepEqual(readyToBillFacet([a, b, c], 'mcNo', partial, lines), [BLANK, 'MC-2'])
})

test('the inspection call list for sharing: party, contract, MC no, item, DALUI, qty ready; ready lines only; nothing internal', () => {
  // source rows full of what must never reach a customer: RM codes, stock locations, supplier / import text, incoming and ETA
  const rmCodes = [{ erpCode: 'RAA010001', location: 'CHINA YARD', qty: 2, spare: false }, { erpCode: 'FSD040050', location: 'KGP', qty: 2, spare: true }]
  const mk = (o: Partial<ContractLine>, qty: number): OfferLine => ({
    ...offer({ actuator: 'ROTORK K30/RPM24@WDAF87Z50CT6', project: 'Imported via Zhejiang Supplier Co', poNo: 'PO-IMPORT-9', ...o }, qty, rmCodes),
    flags: ['production entry from FSD040099', 'actuator held from stock'], remarks: 'China lot, supplier Zhejiang',
  })
  const z2 = mk({ party: 'Zeta', contractNo: 'C9', mcNo: 'OD26Y-00002', itemName: 'GATE VALVE DN150 RAA010001 KGP', partyItemName: 'GATE VALVE DN150' }, 3)
  const z1 = mk({ party: 'Zeta', contractNo: 'C9', mcNo: 'OD26Y-00001', itemName: 'AIR VALVE 80MM FSD040050 CHINA YARD', partyItemName: '  AIR VALVE 80MM ' }, 1)
  const a = mk({ party: 'Alpha', contractNo: 'C5', mcNo: 'OD26Y-00007', itemName: 'Butterfly Valve DN100' }, 2)
  const wiring = mk({ party: 'Alpha', contractNo: 'C1', mcNo: 'OD26Y-00003', itemName: 'Ball Valve DN50' }, 1)
  const part = mk({ party: 'Alpha', contractNo: 'C2', mcNo: 'OD26Y-00004', itemName: 'Check Valve 80mm' }, 1)
  // customer wording wins; the contract's own item name (RM code, location, supplier text) must not leak when it is set
  assert.equal(z2.line.itemName.includes('RAA010001'), true)
  const supplier = mk({ party: 'Omega', contractNo: 'C7', mcNo: 'OD26Y-00009', itemName: 'BALL VALVE Zhejiang Supplier', partyItemName: 'BALL VALVE 40' }, 1)
  const leaky: Partial<LineAllocation> = {
    incomingQty: 777, eta: '31-Dec-2099', flags: ['PN-25 offered against PN-16'],
    suggestions: [{ erpCode: 'FSD040051', qty: 3, note: 'possible after machining' }],
  }
  const lines = [
    alloc(z2, { ...leaky, balanceToOffer: 2 }), // 1 more already offered, not billed: the call is for the 2 not offered yet
    alloc(z1, leaky), alloc(a, leaky), alloc(wiring, { ...leaky, status: WIRING }), alloc(part, { ...leaky, status: 'Partial' }), alloc(supplier, leaky),
  ]
  const offers = [z2, z1, a, wiring, part, supplier]
  const rows = inspectionCallList(offers, q(), lines)
  assert.deepEqual(SHARE_HEADER, ['Party', 'Contract no', 'MC no', 'Item', 'Make', 'Qty ready'])
  assert.deepEqual(rows, [ // party, then contract, then MC no
    ['Alpha', 'C5', 'OD26Y-00007', 'Butterfly Valve DN100', 'DALUI', 2],
    ['Omega', 'C7', 'OD26Y-00009', 'BALL VALVE 40', 'DALUI', 1],
    ['Zeta', 'C9', 'OD26Y-00001', 'AIR VALVE 80MM', 'DALUI', 1],
    ['Zeta', 'C9', 'OD26Y-00002', 'GATE VALVE DN150', 'DALUI', 2],
  ])
  const csv = toCsv(SHARE_HEADER, rows).toUpperCase()
  assert.doesNotMatch(csv, /[A-Z]{2,3}\d{6,7}/) // no ERP / RM code
  for (const text of ['CHINA', 'KGP', 'ZHEJIANG', 'SUPPLIER', 'IMPORT', 'ROTORK', 'RPM', '777', '2099', 'MACHINING', 'PRODUCTION ENTRY', 'PN-25']) {
    assert.ok(!csv.includes(text), `"${text}" reached the list for sharing`)
  }
  // spreadsheet formulas in sheet-synced names stay text; numbers stay numbers; the internal download is not touched
  const evil = ['=HYPERLINK("http://x","y")', '+1', '-2+3', '@SUM(A1)', ' =1+1', '\t=1', '\r@x'].map((name) => mk({ party: name, contractNo: name, mcNo: name, itemName: name }, 1))
  const evilRows = inspectionCallList(evil, q(), evil.map((o) => alloc(o, leaky)))
  assert.equal(evilRows.length, 7)
  for (const row of evilRows) for (const cell of row.slice(0, 4)) assert.match(String(cell), /^'/)
  assert.equal(evilRows.find((r) => r[0] === '+1' || r[0] === "'+1")?.[5], 1)
  assert.equal(typeof evilRows[0][5], 'number')
  // the full filtered set, not one page: filters and search apply, paging does not; a status filter elsewhere leaves none
  assert.equal(inspectionCallList(offers, q({ filters: { party: ['Zeta'] }, pageSize: 1 }), lines).length, 2)
  assert.deepEqual(inspectionCallList(offers, q({ search: 'butterfly' }), lines).map((r) => r[1]), ['C5'])
  assert.deepEqual(inspectionCallList(offers, q({ filters: { allocStatus: [WIRING] } }), lines), [])
})

test('the internal download: every line under the filters and sort, not one page, in the table column order', () => {
  const many = Array.from({ length: 205 }, (_, i) => offer({ contractNo: `K${i}`, mcNo: 'MC-1' }, 1 + (i % 3)))
  const lines = many.map((o) => alloc(o, { status: 'Partial', shortfall: 1 }))
  const rows = readyToBillExport(many, q({ page: 3, pageSize: 50, sort: { key: 'readyQty', dir: 'desc' } }), lines)
  assert.equal(rows.length, 205)
  assert.equal(rows[0].length, READY_COLUMNS.length)
  const col = (key: string) => READY_COLUMNS.findIndex((c) => c.key === key)
  assert.deepEqual([rows[0][col('mcNo')], rows[0][col('allocStatus')], rows[0][col('readyQty')], rows[204][col('readyQty')]], ['MC-1', 'Partial', 3, 1])
  assert.equal(readyToBillExport(many, q({ filters: { contractNo: ['K1', 'K2'] } }), lines).length, 2)
})

test('a line with purchase sources: the inspection call list carries none of lot, Tina invoice, B/L, ETA, ship status, PO no', () => {
  const o = offer({ party: 'Alpha', contractNo: 'C1', mcNo: 'OD26Y-00001', itemName: 'Butterfly Valve DN100' }, 2)
  const a = alloc(o, {
    incomingQty: 3, eta: '27-11',
    sources: [{ poNo: 'PO-9001', poLineNo: '10', lot: '132 LOT', tinaInvoiceNo: 'WS26-340', blNo: 'MEDUACL25001', eta: '27-11', qty: 5, state: 'incoming', needsConfirmation: false }],
  })
  const secrets = ['PO-9001', '132 LOT', 'WS26-340', 'MEDUACL25001', '27-11']
  const rows = inspectionCallList([o], q(), [a])
  assert.equal(rows.length, 1)
  const json = JSON.stringify(rows) + toCsv(SHARE_HEADER, rows)
  for (const s of secrets) assert.ok(!json.includes(s), `"${s}" reached the list for sharing`)
  // The Ready to Bill export is the internal download (it carries ETA and incoming by design), but it must not carry the purchase-side identifiers.
  const exp = JSON.stringify(readyToBillExport([o], q(), [a]))
  for (const s of ['PO-9001', '132 LOT', 'WS26-340', 'MEDUACL25001']) assert.ok(!exp.includes(s), `"${s}" reached the Ready to Bill export`)
  assert.ok(!JSON.stringify(readyToBillPage([o], q(), [a])).includes('MEDUACL25001'))
})
