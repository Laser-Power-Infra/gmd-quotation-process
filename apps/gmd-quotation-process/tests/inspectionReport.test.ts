import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HEADER_FIELDS,
  IC_DUMP_COLUMNS,
  buildDraftReport,
  checkReport,
  cleanTeam,
  groupOfferRows,
  offerChecks,
  parseReportDate,
  reportHtml,
  reportMatches,
  seedTeamFromInspector,
  serialCount,
  serialSummary,
  teamLines,
  type OfferLine,
  type OfferedStock,
  type ReportData,
  type ReportItem,
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

  for (const k of ['kindAttn', 'reference', 'witness'] as const) draft.header[k] = 'x'
  draft.header.jirDate = '05-10-2026'
  draft.items[0].serialFrom = 'S-0001'
  draft.items[0].serialTo = 'S-0250'
  draft.team = [{ agency: 'RITES', name: 'R. Sharma', designation: 'AE' }]
  assert.deepEqual(checkReport(draft).filter((c) => !c.ok), [])

  // 496 - 246 - 251 < 0: over the contract balance.
  draft.items[0].qtyOffered = '251'
  assert.ok(checkReport(draft).some((c) => !c.ok && c.label.includes('contract balance')))
})

const item = (itemCode: string, serialFrom: string, serialTo: string) =>
  ({ itemCode, serialFrom, serialTo }) as ReportItem

test('serial summary: total and first range, every item range for the expand', () => {
  assert.equal(serialSummary([item('IT1', '', ' ')]), null)
  assert.deepEqual(serialSummary([item('IT1', 'S-0001', 'S-0250')]), {
    label: '250 serials: S-0001 – S-0250',
    ranges: ['IT1: S-0001 – S-0250'],
  })
  assert.deepEqual(
    serialSummary([item('IT1', 'S-0001', 'S-0100'), item('IT2', '', ''), item('IT3', 'S-0101', 'S-0150')]),
    { label: '150 serials: S-0001 – S-0100 …', ranges: ['IT1: S-0001 – S-0100', 'IT3: S-0101 – S-0150'] },
  )
  assert.equal(serialSummary([item('IT1', 'S-5', 'S-5')])!.label, '1 serial: S-5 – S-5')
  // A range that cannot be counted drops the total rather than under-count it.
  assert.equal(serialSummary([item('IT1', 'S-0001', 'S-0100'), item('IT2', 'S-7', '')])!.label, 'S-0001 – S-0100 …')
})

test('inspecting team lines skip blank parts and blank members', () => {
  assert.deepEqual(teamLines(undefined), [])
  assert.deepEqual(
    teamLines([
      { agency: ' RITES ', name: 'R. Sharma', designation: 'AE' },
      { agency: '', name: ' ', designation: '' },
      { agency: 'PHED', name: '', designation: 'EE' },
    ]),
    ['RITES, R. Sharma, AE', 'PHED, EE'],
  )
})

const fullItem = (o: Partial<ReportItem>): ReportItem => ({
  itemCode: 'IT1', itemName: 'Valve', size: '100', pnRating: 'PN16', material: 'DI', um: 'NOS', contractQty: '10',
  alreadyInspected: '0', qtyOffered: '5', reportQty: '5', serialFrom: 'S-1', serialTo: 'S-5', remarks: '', ...o,
})

/** A report that passes every check. */
const fullReport = (): ReportData => ({
  header: {
    ...(Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, 'x'])) as ReportData['header']),
    offerDate: '01-10-2026', inspectionDate: '05-10-2026', jirDate: '05-10-2026',
  },
  items: [fullItem({})],
  team: [{ agency: 'RITES', name: 'R. Sharma', designation: 'AE' }],
  qap: { qapNo: 'QAP-7', mfgStandard: 'IS 14846', bodyPressure: '24 bar', seatPressure: '16 bar', duration: '5 min' },
  tolerance: '', mtc: '', observations: '',
})

test('the inspecting team gates reviewed / final: a member, each with agency, name and designation', () => {
  const teamCheck = (r: ReportData) => checkReport(r).find((c) => c.label.startsWith('Inspecting team'))
  const r = fullReport()
  assert.deepEqual(checkReport(r).filter((c) => !c.ok), [])

  r.team = undefined
  assert.deepEqual(teamCheck(r), { label: 'Inspecting team filled (agency, name, designation)', ok: false, detail: 'No member added' })
  r.team = [{ agency: 'RITES', name: 'R. Sharma', designation: 'AE' }, { agency: 'PHED', name: ' ', designation: 'EE' }]
  assert.equal(teamCheck(r)!.ok, false)
  assert.equal(teamCheck(r)!.detail, '1 member missing agency, name or designation')
})

test('a report saved before the team section shows its header inspector as the first member', () => {
  const old = (inspector: string, team?: ReportData['team']) =>
    ({ ...fullReport(), team, header: { ...fullReport().header, inspector } }) as ReportData
  const seeded = seedTeamFromInspector(old(' R. Sharma '))
  assert.deepEqual(seeded.team, [{ agency: '', name: 'R. Sharma', designation: '' }])
  assert.deepEqual(seedTeamFromInspector(old('R. Sharma', [])).team, [{ agency: '', name: 'R. Sharma', designation: '' }])
  // Saved with that member removed, it is not seeded again.
  assert.deepEqual(seedTeamFromInspector({ ...seeded, team: [] }).team, [])
  // A filled team or a blank inspector (old drafts) is left alone.
  const team = [{ agency: 'RITES', name: 'A', designation: 'AE' }]
  assert.deepEqual(seedTeamFromInspector(old('R. Sharma', team)).team, team)
  assert.equal(seedTeamFromInspector(old(' ')).team, undefined)
})

test('a saved team is cleaned: non-object members dropped, fields coerced to trimmed strings', () => {
  assert.deepEqual(cleanTeam(undefined), [])
  assert.deepEqual(cleanTeam('RITES'), [])
  const team = cleanTeam([{ agency: ' RITES ', name: 42, designation: null }, 'x', null, 7, { name: { a: 1 } }])
  assert.deepEqual(team, [{ agency: 'RITES', name: '42', designation: '' }, { agency: '', name: '', designation: '' }])
  // The checks and the list's team lines run on it instead of throwing.
  assert.deepEqual(teamLines(team), ['RITES, 42'])
  assert.equal(checkReport({ ...fullReport(), team }).find((c) => c.label.startsWith('Inspecting team'))!.ok, false)
})

test('required vs offered compares PN, size and material of each stock row set against the item', () => {
  const items = [
    fullItem({ itemCode: 'IT1', pnRating: 'PN16', size: '100', material: 'DI' }),
    fullItem({ itemCode: 'IT2', pnRating: 'PN10', size: '150', material: '' }),
    fullItem({ itemCode: 'IT3' }),
  ]
  const offered: OfferedStock[] = [
    { itemCode: ' it1', erpCode: 'IT1', qty: 5, pn: 'PN 16', size: 'DN100', material: 'DUCTILE IRON' },
    // Diverted: another item code, and its PN and material differ.
    { itemCode: 'IT1', erpCode: 'RXV9', qty: 2, pn: 'PN25', size: '100', material: 'CARBON STEEL/CAST STEEL' },
    // A blank required material is not compared.
    { itemCode: 'IT2', erpCode: 'RXV7', qty: 3, pn: '10', size: '150 MM', material: 'CAST IRON' },
    { itemCode: 'OTHER', erpCode: 'IT3', qty: 9, pn: 'PN16', size: '100', material: 'DI' },
  ]
  assert.deepEqual(offerChecks(items, offered), [
    { itemCode: 'IT1', required: 'PN16 / 100 / DI', offered: 'IT1 × 5: PN 16 / DN100 / DUCTILE IRON', diff: '' },
    {
      itemCode: 'IT1', required: 'PN16 / 100 / DI',
      offered: 'RXV9 × 2: PN25 / 100 / CARBON STEEL/CAST STEEL (other item code)', diff: 'Differs: PN, material',
    },
    { itemCode: 'IT2', required: 'PN10 / 150 / -', offered: 'RXV7 × 3: 10 / 150 MM / CAST IRON (other item code)', diff: '' },
    { itemCode: 'IT3', required: 'PN16 / 100 / DI', offered: '-', diff: 'No stock allocated' },
  ])
  // CLASS 150 is not PN150; a different size is flagged.
  assert.equal(
    offerChecks([fullItem({ pnRating: 'CLASS 150', size: '200' })], [
      { itemCode: 'IT1', erpCode: 'IT1', qty: 1, pn: 'PN150', size: '250', material: 'DI' },
    ])[0].diff,
    'Differs: PN, size',
  )
})

/** The diff of one IT1 item against one IT1 stock row; both default to PN16 / 100 / DI. */
const diffOf = (it: Partial<ReportItem>, o: Partial<OfferedStock>) =>
  offerChecks([fullItem(it)], [{ itemCode: 'IT1', erpCode: 'IT1', qty: 1, pn: 'PN16', size: '100', material: 'DI', ...o }])[0].diff

test('material families: SS grades and CF8M, forged (A105) and mild steel match their long names', () => {
  for (const [want, got] of [
    ['SS', 'SS304'], ['SS', 'CF8M'], ['SS304', 'SS 304'], ['FORGED', 'FORGED STEEL'], ['A105', 'FORGED'], ['MS', 'MILD STEEL'],
  ]) {
    assert.equal(diffOf({ material: want }, { material: got }), '', `${want} vs ${got}`)
  }
  assert.equal(diffOf({ material: 'SS' }, { material: 'BRASS' }), 'Differs: material')
})

test('a stock row with no part comparable is "Not compared (blank)"; sheet placeholders count as blank', () => {
  assert.equal(diffOf({ pnRating: '', size: ' ', material: '' }, {}), 'Not compared (blank)')
  assert.equal(diffOf({}, { pn: '#N/A', size: 'NA', material: '-' }), 'Not compared (blank)')
  assert.equal(diffOf({}, { pn: 'n/a', size: '', material: '' }), 'Not compared (blank)')
  // Placeholders are skipped part by part: material DI = DI is compared, so OK.
  assert.equal(diffOf({}, { pn: 'N/A', size: '-' }), '')
})

test('printable report: header, team, items, required vs offered and QAP, all escaped', () => {
  const r = fullReport()
  r.header.client = 'A <b>&</b> B'
  const html = reportHtml(r, offerChecks(r.items, []), new Date(2026, 10, 12, 14, 5))
  for (const part of ['Witness', 'RITES', 'R. Sharma', 'Serial from', 'S-5', 'No stock allocated', 'QAP-7', 'A &lt;b&gt;&amp;&lt;/b&gt; B']) {
    assert.ok(html.includes(part), part)
  }
  assert.ok(!html.includes('<b>'))
  // Stamped, so a re-printed final report is not read as the stock at inspection time.
  assert.match(html, /Required vs offered as of 12 Nov 2026, 2:05/)
  assert.ok(reportHtml(r, null).includes('Stock allocation unavailable'))
})

test('list search matches the contract no. and serials, including one inside a range', () => {
  const data = { header: { contractNo: 'SD26Y-1' }, items: [item('IT1', 'GMD-0101', 'GMD-0150')] } as ReportData
  for (const q of ['sd26y', 'GMD-0101', 'gmd-0125', 'GMD-125', 'GMD-01']) assert.ok(reportMatches(data, q), q)
  for (const q of ['GMD-0151', 'GMD-0100', 'XYZ-0125', 'PO1']) assert.ok(!reportMatches(data, q), q)
})

test('a huge digit search returns fast instead of backtracking the serial regex', () => {
  const items = Array.from({ length: 100 }, () => item('IT1', 'GMD-0101', 'GMD-0150'))
  const data = { header: { contractNo: 'SD26Y-1' }, items } as ReportData
  const t0 = performance.now()
  assert.equal(reportMatches(data, '1'.repeat(16000) + 'A'), false)
  const ms = performance.now() - t0
  assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`)
})
