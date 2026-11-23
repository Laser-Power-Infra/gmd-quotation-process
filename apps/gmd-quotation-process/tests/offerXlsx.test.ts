import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { buildOfferXlsx, OFFER_STATIC_TEXT } from '../lib/offerXlsx.js'
import { oneClickAccess } from '../lib/oneClickAccess.js'
import type { OfferLetterTemplateData } from '../types/offer-lettter.js'

const LIB = path.join(import.meta.dirname, '..', 'lib')

const ACTUATED_NAME = [
  'DI BUTTERFLY VALVE 600 MM PN16',
  'Actuator: AUMA SA 14.2 | Gearbox: Viral SGB-600',
  'Type: Integral, electric part-turn',
  'Power supply: 415 V, 3 phase, 50 Hz',
].join('\n')

const item = (o: Partial<OfferLetterTemplateData['items'][number]>) => ({
  itemName: 'party item', partyItemName: 'OUR ITEM', quantity: 1, quotationRate: 100, quotedRateGst: 118, totalValue: 118,
  unit: 'Nos.' as const, deliverySchedule: '2-3 weeks', imageRowspan: 0, nameRowspan: 1, ...o,
})

const DATA: OfferLetterTemplateData = {
  docketNo: 'GMD/2026-27/999', state: 'WB', partyName: 'KALPATARU PROJECTS', subject: 'Offer For Supply under @ OGKR',
  price: 'The Quoted prices are on Firm basis, valid for 60days.', paymentTerms: '30 days', inspection: 'Our scope',
  warranty: '18 months', approval: 'It shall be in our scope', deliveryDestination: 'WB', totalItemwiseValue: 0,
  items: [
    item({ slNo: 1, itemName: 'BFV 600 with PT', partyItemName: ACTUATED_NAME, quantity: 2, quotationRate: 1000.5, quotedRateGst: 1180.59, totalValue: 2361.18, nameRowspan: 2 }),
    item({ slNo: 2, itemName: 'BFV 600 spare', partyItemName: ACTUATED_NAME, quantity: 3, quotationRate: 1000.5, quotedRateGst: 1180.59, totalValue: 3541.77, nameRowspan: 0 }),
    item({ slNo: 0, itemName: 'Fire hydrant', partyItemName: '', isNotOurProduct: true, quantity: 0, quotationRate: 0, quotedRateGst: 0, totalValue: 0, nameRowspan: 0 }),
    item({ slNo: 3, itemName: 'Sluice valve 100', partyItemName: 'DI SLUICE VALVE 100 MM', quantity: 5, quotationRate: 200, quotedRateGst: 236, totalValue: 1180 }),
  ],
}

const file = buildOfferXlsx(DATA)
const wb = XLSX.read(file, { type: 'buffer' })
const annexure = wb.Sheets['Annexure-A']
const letter = wb.Sheets['Offer']
const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(annexure, { header: 1, defval: null })
const cell = (r: number, c: number) => annexure[XLSX.utils.encode_cell({ r, c })]

test('annexure has the PDF columns minus IMAGE, and no actuator price column', () => {
  assert.deepEqual(wb.SheetNames, ['Offer', 'Annexure-A'])
  assert.deepEqual(rows[1], ['SL NO', 'PARTY ITEM NAME', 'OUR ITEM NAME', 'RATE/UNIT', 'QTY', 'UNIT', 'QR with GST', 'Total Val. Incld. GST', 'Delivery Schedule'])
  assert.equal(rows[1].some((h) => /actuator|gearbox/i.test(String(h))), false)
  // Same headers as the PDF template, IMAGE aside.
  const template = fs.readFileSync(path.join(LIB, 'offer_letter.hbs'), 'utf8')
  const pdfColumns = [...template.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1])
  assert.deepEqual(pdfColumns.filter((c) => c !== 'IMAGE'), rows[1])
})

test('every item row is in the workbook, with numbers as numeric cells', () => {
  assert.deepEqual(rows[2], [1, 'BFV 600 with PT', ACTUATED_NAME, 1000.5, 2, 'Nos.', 1180.59, 2361.18, '2-3 weeks'])
  assert.deepEqual(rows[3], [2, 'BFV 600 spare', null, 1000.5, 3, 'Nos.', 1180.59, 3541.77, '2-3 weeks'])
  assert.deepEqual(rows[4].slice(0, 3), [null, 'Fire hydrant', 'Not our product'])
  assert.deepEqual(rows[5], [3, 'Sluice valve 100', 'DI SLUICE VALVE 100 MM', 200, 5, 'Nos.', 236, 1180, '2-3 weeks'])
  assert.equal(rows.length, 2 + DATA.items.length + 1)
  for (const r of [2, 3, 5]) for (const c of [0, 3, 4, 6, 7]) assert.equal(cell(r, c).t, 'n', `row ${r} col ${c}`)
})

test('total row carries the PDF footer sums as numbers', () => {
  const total = rows[6]
  assert.equal(total[0], 'Total')
  assert.equal(total[3], Math.round(2 * 1000.5 + 3 * 1000.5 + 5 * 200))
  assert.equal(total[4], 10)
  assert.equal(total[7], Math.round(2361.18 + 3541.77 + 1180))
  for (const c of [3, 4, 7]) assert.equal(cell(6, c).t, 'n')
})

test('a multi-line item name keeps its line breaks, is merged over its rows, wrapped and tall enough', () => {
  assert.equal(cell(2, 2).v, ACTUATED_NAME)
  assert.equal(cell(2, 2).v.split('\n').length, 4)
  const merges = (annexure['!merges'] ?? []).map((m) => XLSX.utils.encode_range(m))
  assert.ok(merges.includes('C3:C4'), 'name merged over both rows')
  assert.ok(merges.includes('C5:I5'), 'not our product spans to the last column')
  assert.ok(merges.includes('A7:C7'), 'total label')

  // Wrap text and row heights are only visible in the raw file.
  const zip = XLSX.CFB.read(file, { type: 'buffer' })
  const part = (name: string) => Buffer.from(XLSX.CFB.find(zip, name)!.content as Uint8Array).toString('utf8')
  assert.match(part('/xl/styles.xml'), /<cellXfs[^>]*>(<xf [^>]*applyAlignment="1"><alignment vertical="top" wrapText="1"\/><\/xf>)+<\/cellXfs>/)
  const heights = new Map([...part('/xl/worksheets/sheet2.xml').matchAll(/<row r="(\d+)" ht="([\d.]+)" customHeight="1"/g)].map((m) => [Number(m[1]), Number(m[2])]))
  // 4 name lines over 2 merged rows, 16pt a line.
  assert.ok(heights.get(3)! + heights.get(4)! >= 4 * 16)
  // A single unmerged row shows all its lines by itself.
  const solo = buildOfferXlsx({ ...DATA, items: [item({ slNo: 1, partyItemName: ACTUATED_NAME })] })
  const soloZip = XLSX.CFB.read(solo, { type: 'buffer' })
  const soloXml = Buffer.from(XLSX.CFB.find(soloZip, '/xl/worksheets/sheet2.xml')!.content as Uint8Array).toString('utf8')
  assert.ok(Number(soloXml.match(/<row r="3" ht="([\d.]+)"/)![1]) >= 4 * 16)
})

test('letter sheet carries docket, party, subject and the six terms', () => {
  const text = XLSX.utils.sheet_to_json<string[]>(letter, { header: 1, defval: '' }).map((r) => r.join(' | '))
  for (const want of ['OFFER NO | GMD/2026-27/999', 'To, | KALPATARU PROJECTS', 'SUB: | Offer For Supply under @ OGKR', `1. Price : | ${DATA.price}`, '2. Payment Terms : | 30 days', '3. Inspection : | Our scope', '4. Warranty : | 18 months', '5. Approval : | It shall be in our scope', '6. Delivery Destination : | WB', 'Enclosed : | Annexure-A (Price Bid)']) {
    assert.ok(text.includes(want), want)
  }
})

test('fixed wording of the Excel is the wording of the PDF template', () => {
  const template = fs.readFileSync(path.join(LIB, 'offer_letter.hbs'), 'utf8').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
  const fixed = Object.values(OFFER_STATIC_TEXT).flat().filter((t) => !OFFER_STATIC_TEXT.columns.includes(t as never))
  for (const t of fixed) assert.ok(template.includes(t), t)
})

test('Excel goes through the same refusal and the same one-time freeze as the PDF', () => {
  // The refusal itself knows nothing about a format.
  assert.equal(oneClickAccess('No', null).allowed, false)
  assert.equal(oneClickAccess('Yes', new Date()).allowed, false)
  assert.equal(oneClickAccess('Yes', null).allowed, true)

  const src = fs.readFileSync(path.join(LIB, 'offerPdf.ts'), 'utf8')
  const build = src.slice(src.indexOf('export async function buildOfferPdf('))
  const refusal = build.indexOf('oneClickAccess(')
  const firstFormatBranch = build.indexOf('format ===')
  assert.ok(refusal > 0 && firstFormatBranch > refusal, 'refusal runs before any PDF/Excel branch')
  // Neither the refusal nor the freeze write depends on the format.
  const refusalIf = build.slice(build.lastIndexOf('if (', refusal), refusal)
  assert.doesNotMatch(refusalIf, /format/)
  const freezeIf = build.match(/if \(([^\n]*)offerPdfGeneratedAt\) \{/)![0]
  assert.match(freezeIf, /!bypassFreeze/)
  assert.doesNotMatch(freezeIf, /format/)
  // The Excel renderer is called from this one builder only, and the email path asks for no format (PDF).
  const callers = fs.readdirSync(LIB).filter((f) => /\.tsx?$/.test(f) && /buildOfferXlsx\(/.test(fs.readFileSync(path.join(LIB, f), 'utf8')))
  assert.deepEqual(callers.sort(), ['offerPdf.ts', 'offerXlsx.ts'])
  // The browser action is one guarded function that only passes the format through.
  const action = fs.readFileSync(path.join(LIB, 'generate-offer-pdf.ts'), 'utf8')
  assert.equal((action.match(/^export async function /gm) ?? []).length, 1)
  assert.match(action, /await requireAccess\(\);[\s\S]*await loginRequired\(\)[\s\S]*buildOfferPdf\(rowData, enquiryId, \{ format/)
})
