import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IC_DUMP_COLUMNS,
  buildDraftReport,
  checkReport,
  groupOfferRows,
  parseReportDate,
  serialCount,
  type OfferLine,
} from '../lib/inspectionReport.js'

const line = (o: Partial<OfferLine>): OfferLine =>
  ({ ...Object.fromEntries(IC_DUMP_COLUMNS.map((c) => [c, ''])), ...o }) as OfferLine

test('groups lines per VRNO and drops blank VRNO', () => {
  const g = groupOfferRows([
    line({ VRNO: 'ID26Y-1', VRDATE: '01-10-2026', ITEM_CODE: 'A' }),
    line({ VRNO: 'ID26Y-1', ITEM_CODE: 'B' }),
    line({ VRNO: '', ITEM_CODE: 'C' }),
    line({ VRNO: 'ID26Y-2', ITEM_CODE: 'D' }),
  ])
  assert.equal(g.size, 2)
  assert.equal(g.get('ID26Y-1')!.lines.length, 2)
  assert.equal(g.get('ID26Y-1')!.vrDate, '01-10-2026')
})

test('dates and serial ranges', () => {
  assert.equal(parseReportDate('29-10-2026'), Date.UTC(2026, 9, 29))
  assert.equal(parseReportDate('29-Oct-2026'), Date.UTC(2026, 9, 29))
  assert.equal(parseReportDate('2026-10-29'), Date.UTC(2026, 9, 29))
  assert.equal(parseReportDate('junk'), null)
  assert.equal(serialCount('GMD-0101', 'GMD-0150'), 50)
  assert.equal(serialCount('A-1', 'B-5'), null)
  assert.equal(serialCount('A-9', 'A-1'), null)
})

test('draft is filled from ContractReview and checks gate a complete report', () => {
  const offer = groupOfferRows([
    line({ VRNO: 'ID26Y-1', VRDATE: '01-10-2026', ITEM_CODE: 'IT1', CONTRACT_VRNO: 'MC-1', AQTYORDER: '250', QTYCANCELLED: '0', INSPE_VRNO: 'IC26Y-1', INSPE_DATE: '05-10-2026', UM: 'NOS' }),
  ]).get('ID26Y-1')!
  const draft = buildDraftReport(
    offer,
    (mc, item) => (mc === 'MC-1' && item === 'IT1'
      ? { contractNo: 'SD26Y-1', mcNo: 'MC-1', itemCode: 'IT1', itemName: 'Valve', size: '50', pnRating: 'PN16', orderQty: '496', icQty: '246', poNo: 'PO1', dateOfContract: '01-09-2026', projectReference: 'Proj', utility: 'U', state: 'S', partyNameDump: 'Party' }
      : undefined),
    'Client Ltd',
  )
  assert.equal(draft.header.client, 'Client Ltd')
  assert.equal(draft.header.contractNo, 'SD26Y-1')
  assert.equal(draft.items[0].qtyOffered, '250')

  // Fresh draft: inspector-only fields blank, so it cannot pass.
  assert.ok(checkReport(draft).some((c) => !c.ok))

  for (const k of ['kindAttn', 'reference', 'inspector', 'witness'] as const) draft.header[k] = 'x'
  draft.header.jirDate = '05-10-2026'
  draft.items[0].serialFrom = 'S-0001'
  draft.items[0].serialTo = 'S-0250'
  assert.deepEqual(checkReport(draft).filter((c) => !c.ok), [])

  // 496 - 246 - 251 < 0: over the contract balance.
  draft.items[0].qtyOffered = '251'
  assert.ok(checkReport(draft).some((c) => !c.ok && c.label.includes('contract balance')))
})
