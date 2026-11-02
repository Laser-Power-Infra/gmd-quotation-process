import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contractRateByCode,
  findCodeMismatches,
  groupLinesByContract,
  mergeContractNos,
  normalizeParty,
  rankDocketsForContracts,
  skippedRateLines,
  type ContractLine,
  type DocketForMatch,
} from '../lib/contractDocketMatch.js'

const line = (contractNo: string, itemCode: string, size: string, orderQty: string, rate = '1,000.00'): ContractLine =>
  ({ contractNo, itemCode, size, orderQty, rate })
const item = (id: string, erpItemCode: string | null, size: string, quantity: number) =>
  ({ id, erpItemCode, size, quantity })
const docket = (docketNumber: string, items: ReturnType<typeof item>[], selectedContractNo: string[] = [], enquiryDate = '2026-05-01'): DocketForMatch =>
  ({ id: docketNumber, docketNumber, partyName: 'P', enquiryDate, selectedContractNo, items })

// Contract SD26Y-00058 (DN80 lines) vs docket GMD/2026-27/306 before the fix.
const c58 = [
  line('SD26Y-00058', 'FSD040044', '80', '716', '2,750.00'),
  line('SD26Y-00058', 'FVD010019', '80', '94', '2,000.00'),
  line('SD26Y-00058', 'FSD040004', '80', '94', '2,400.00'),
  line('SD26Y-00058', 'FHD010023', '80', '20', '2,500.00'),
  line('SD26Y-00058', 'FSD040084', '250', '8', '14,000.00'),
  line('SD26Y-00058', 'FSD040001', '100', '578', '3,100.00'),
]
const d306 = [
  item('air', 'FCF120008', '80', 94),
  item('iso', 'FSD040004', '80', 94),
  item('dpcv', 'FCF090034', '80', 20),
  item('sluice80', 'FSD040004', '80', 716),
  item('ok100', 'FSD040001', '100', 578),
  item('sluice250', 'FSC060014', '250', 8),
]

test('code check flags the four wrong 306 codes and keeps the isolation valve', () => {
  const flagged = findCodeMismatches(d306, c58)
  assert.deepEqual(flagged.map((f) => f.itemId).sort(), ['air', 'dpcv', 'sluice250', 'sluice80'])
  const byId = Object.fromEntries(flagged.map((f) => [f.itemId, f.contractCodes]))
  assert.deepEqual(byId.sluice80, ['FSD040044'])
  assert.deepEqual(byId.dpcv, ['FHD010023'])
  assert.deepEqual(byId.sluice250, ['FSD040084'])
  // Two DN80 x 94 lines on the contract: both are offered, the docket code is on neither.
  assert.deepEqual(byId.air, ['FSD040004', 'FVD010019'])
})

test('code check ignores lines with no same size+qty contract line', () => {
  assert.deepEqual(findCodeMismatches([item('x', 'FOO', '80', 7), item('y', null, '', 94)], c58), [])
})

test('ranking: equal total qty per code wins, duplicate docket lines are summed', () => {
  const c76 = [line('SD26Y-00076', 'FF2020004', '40', '3'), line('SD26Y-00076', 'FGD060043', '100', '4'), line('SD26Y-00076', 'FGD060045', '250', '1')]
  const d087 = docket('087', [item('a', 'FF2020004', '40', 2), item('b', 'FF2020004', '40', 1), item('c', 'FGD060043', '100', 4), item('d', 'FGD060045', '250', 1)])
  const near = docket('086', [item('a', 'FF2020004', '40', 3), item('c', 'FGD060043', '100', 9)], [], '2026-09-01')
  const other = docket('999', [item('z', 'NOPE', '40', 3)])
  const ranked = rankDocketsForContracts(['SD26Y-00076'], [near, other, d087], groupLinesByContract(c76))
  assert.deepEqual(ranked.map((r) => r.docketNumber), ['087', '086'])
  assert.equal(ranked[0].matchedCodes.length, 3)
  assert.equal(ranked[1].matchedCodes.length, 1)
})

test('ranking: a multi-contract docket uses total qty over all its contracts', () => {
  const lines = [line('C67', 'FSD040001', '100', '15'), line('C68', 'FSD040001', '100', '8'), line('C68', 'FSD040002', '150', '4')]
  const d312 = docket('312', [item('a', 'FSD040001', '100', 15), item('b', 'FSD040001', '100', 8), item('c', 'FSD040002', '150', 4)], ['C67'])
  const [best] = rankDocketsForContracts(['C68'], [d312], groupLinesByContract(lines))
  assert.deepEqual(best.contractNos, ['C67', 'C68'])
  assert.deepEqual(best.matchedCodes, ['FSD040001', 'FSD040002'])
})

test('contract rate per code: one rate only, commas parsed', () => {
  const rates = contractRateByCode([line('A', 'X', '80', '1', '2,750.00'), line('B', 'X', '80', '2', '2750'), line('A', 'Y', '80', '1', '10'), line('B', 'Y', '80', '1', '11')])
  assert.equal(rates.get('X'), 2750)
  assert.equal(rates.has('Y'), false)
})

test('skipped lines: wrong docket code is reported, not silently left without a rate', () => {
  const skipped = skippedRateLines(d306, c58, new Set(['FSD040001']))
  assert.deepEqual(skipped.map((s) => s.itemId).sort(), ['air', 'dpcv', 'sluice250', 'sluice80'])
  const sluice80 = skipped.find((s) => s.itemId === 'sluice80')!
  assert.equal(sluice80.code, 'FSD040004')
  assert.match(sluice80.reason, /not on contract.*FSD040044/)
})

test('skipped lines: a matched code with several contract rates is reported, no rate picked', () => {
  const lines = [line('A', 'X', '80', '1', '100'), line('B', 'X', '80', '1', '120'), line('A', 'Y', '50', '2', '50')]
  const items = [item('x1', 'X', '80', 1), item('x2', 'X', '80', 1), item('y', 'Y', '50', 2)]
  const skipped = skippedRateLines(items, lines, new Set(['X', 'Y']))
  assert.deepEqual(skipped.map((s) => s.itemId), ['x1', 'x2'])
  assert.match(skipped[0].reason, /2 different contract rates \(100, 120\)/)
  assert.equal(contractRateByCode(lines).has('X'), false)
})

test('helpers', () => {
  assert.equal(normalizeParty('Kalpataru Projects Intl. Ltd'), 'KALPATARU PROJECTS INTL LIMITED')
  assert.deepEqual(mergeContractNos(['SD1', 'sd2 '], ['SD2', 'SD3']), ['SD1', 'sd2', 'SD3'])
})
