import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDraft, groupOffers, OFFER_COLUMNS, type ContractLine } from '../lib/inspectionOffer.js'

const sheet = [[...OFFER_COLUMNS], ...[['ID26Y-1', '01/11/2026', 'F1', 'NOS', '250', 'A', 'SD26Y-58', '', '03/11/2026', '', '', '', '', '0', '246', '', '', '', '']]
  .map((r) => r)]
const line: ContractLine = { mcNo: 'SD26Y-58', itemCode: 'F1', itemName: 'Valve', size: '100', pnRating: 'PN16', orderQty: '716', mcQty: '716', balanceMc: null, dateOfContract: '01-10-2026', contractNo: 'C', partyNameDump: 'Kalpataru', projectReference: 'P' }

test('groups by VRNO and builds balance = contract - inspected - offered', () => {
  const g = groupOffers(sheet)
  const d = buildDraft('ID26Y-1', g.get('ID26Y-1')!, [line])
  assert.equal(d.items[0].balance, 220)
  assert.ok(!d.issues.some((i) => /exceeds|blank|after/.test(i)))
})

test('flags over-offer, missing contract line and date order', () => {
  const g = groupOffers([sheet[0], ['ID26Y-2', '05/11/2026', 'F1', 'NOS', '800', 'A', 'SD26Y-58', '', '03/11/2026', ...Array(9).fill(''), '']])
  const d = buildDraft('ID26Y-2', g.get('ID26Y-2')!, [line])
  assert.ok(d.issues.some((i) => /exceeds/.test(i)))
  assert.ok(d.issues.some((i) => /after the inspection/.test(i)))
  assert.ok(buildDraft('ID26Y-2', g.get('ID26Y-2')!, []).issues.some((i) => /no Contract Review line/.test(i)))
})

test('missing sheet column throws', () => {
  assert.throws(() => groupOffers([['VRNO']]), /missing columns/)
})
