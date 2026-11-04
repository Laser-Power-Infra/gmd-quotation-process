import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCfSet, firstNumberKey, mocKey, mocKeys, type CfFlangeRow, type CfRates } from '../lib/cfSet.js'
import { parseRateRows } from '../lib/rateLookup.js'
import { evaluateCostWarnings, COST_WARNING } from '../lib/costSanity.js'

const rates: CfRates = {
  flange: { MS: 60, SS: 300 },
  fastener: { GI: 80, SS: 250 },
  gasket: { RUBBER: 150, CAF: 400 },
  machining: { '150-300': 25 },
}
const densities = new Map([['MILD STEEL', 7.85]])

const row = (over: Partial<CfFlangeRow>): CfFlangeRow => ({
  rowIndex: 1, size: '100', moc: 'MS', pnRatingClass: 'PN10', standards: 'IS 1538',
  idMm: '100', odMm: '220', pcdMm: '180', noOfHoleNos: '8', holeDia: '18', thicknessOfFlange: '20',
  totalWeightKg: '2.89', boltWeight: '0.12|GI', nutWeight: '0.24', ...over,
})
const dn100 = row({})
const dn200 = row({ rowIndex: 2, size: '200', idMm: '200', odMm: '340', pcdMm: '295', holeDia: '22', thicknessOfFlange: '24', totalWeightKg: '', boltWeight: '0.2|GI', nutWeight: '0.4' })
const dn300 = row({ rowIndex: 3, size: '300', idMm: '300', odMm: '445', pcdMm: '400', noOfHoleNos: '12', holeDia: '22', thicknessOfFlange: '26', totalWeightKg: '9.5', boltWeight: '0.15|GI', nutWeight: '0.3' })
const master = [dn100, dn200, dn300]

const valve = (size: string, others: string[] = ['flange'], over: Record<string, unknown> = {}) => ({
  size, pnRating: 'PN10', moc: 'DUCTILE IRON/CAST IRON', itemType: 'SLUICE VALVE-RESILIENT-NON-RISING',
  itemName: `CI sluice valve DN${size} PN10`, others, ...over,
})
const gasketKg = (id: number, pcd: number, hole: number) => (Math.PI / 4) * ((pcd - hole) ** 2 - id ** 2) * 3 * 1.5 / 1e6
const r2 = (n: number) => Number(n.toFixed(2))

test('normalizers', () => {
  assert.equal(firstNumberKey('DN 50'), '50')
  assert.equal(firstNumberKey('PN-10/16'), '10')
  assert.equal(firstNumberKey(''), null)
  assert.equal(mocKey('C.I.'), 'CI')
  assert.equal(mocKey('Cast Iron'), 'CI')
  assert.deepEqual([...mocKeys('DUCTILE IRON/CAST IRON')], ['DI', 'CI'])
})

test('rate rows parse "KEY=rate;from=date", including keys that contain "="', () => {
  const { rates: r, dates } = parseRateRows(
    [{ value: 'MS=61.5;from=2026-11-04' }, { value: '<=100=25' }, { value: 'GI=' }, { value: 'junk' }],
    ['MS', '<=100', 'GI'],
  )
  assert.deepEqual(r, { MS: '61.5', '<=100': '25', GI: '' })
  assert.equal(dates.MS, '2026-11-04')
})

test('DN100 PN10 IS 1538: full set (acceptance)', () => {
  const res = computeCfSet(valve('100'), master, rates, densities)
  const cf = 2 * 2.89 * 60 // 346.80
  const bolts = 8 * 2 * 0.12 * 80 // 153.60
  const nuts = 8 * 2 * 0.24 * 80 // 307.20
  const gaskets = 2 * gasketKg(100, 180, 18) * 150 // OD = 180-18 = 162
  assert.deepEqual(res.missing, [])
  assert.deepEqual(res.lines.map((l) => [l.part, l.qty]), [['CF', 2], ['Bolts', 16], ['Nuts', 16], ['Gaskets', 2]])
  assert.deepEqual(res.lines.map((l) => l.cost), [r2(cf), r2(bolts), r2(nuts), r2(gaskets)])
  assert.equal(res.total, r2(r2(cf) + r2(bolts) + r2(nuts) + r2(gaskets)))
  assert.equal(res.flangeRowIndex, 1)
  assert.equal(res.standardAssumed, false)
})

test('DN200 PN10: blank master weight falls back to the ring formula', () => {
  const res = computeCfSet(valve('200'), master, rates, densities)
  const ringKg = ((Math.PI / 4) * (340 ** 2 - 200 ** 2 - 8 * 22 ** 2) * 24 * 7.85) / 1e6
  const cf = 2 * (ringKg * 60 + 25) // DN200 is in the 150-300 machining band: +25 per CF
  assert.equal(res.lines[0].cost, r2(cf))
  assert.equal(r2(res.lines[0].unitKg), r2(ringKg))
  assert.equal(res.lines[1].cost, r2(8 * 2 * 0.2 * 80)) // 256.00
  assert.equal(res.lines[2].cost, r2(8 * 2 * 0.4 * 80)) // 512.00
  assert.deepEqual(res.missing, [])
})

test('DN300 PN10: machining band added to each CF', () => {
  const res = computeCfSet(valve('300'), master, rates, densities)
  assert.equal(res.lines[0].cost, r2(2 * (9.5 * 60 + 25))) // 2 x 595 = 1190
  assert.equal(res.lines[1].cost, r2(12 * 2 * 0.15 * 80)) // 288
  assert.equal(res.lines[2].cost, r2(12 * 2 * 0.3 * 80)) // 576
})

test('partial sets: gasket only / nut and bolt only', () => {
  const g = computeCfSet(valve('100', ['gasket']), master, rates, densities)
  assert.deepEqual(g.lines.map((l) => l.part), ['Gaskets'])
  const nb = computeCfSet(valve('100', ['nut and bolt']), master, rates, densities)
  assert.deepEqual(nb.lines.map((l) => l.part), ['Bolts', 'Nuts'])
  assert.equal(computeCfSet(valve('100', []), master, rates, densities).lines.length, 0)
})

test('size with no master row: missing flag, no zero line', () => {
  const res = computeCfSet(valve('250'), master, rates, densities)
  assert.deepEqual(res.lines, [])
  assert.equal(res.total, 0)
  assert.equal(res.missing.length, 1)
  assert.match(res.missing[0], /no flange master row/i)
})

test('missing rate is reported, other lines still priced', () => {
  const res = computeCfSet(valve('100'), master, { ...rates, flange: {} }, densities)
  assert.deepEqual(res.lines.map((l) => l.part), ['Bolts', 'Nuts', 'Gaskets'])
  assert.match(res.missing.join(' '), /CF_FLANGE_RATE MS/)
})

test('wafer BFV: studs = holes, nuts = holes x 2, stud weight = 2 x master bolt', () => {
  const res = computeCfSet(
    valve('100', ['flange'], { itemType: 'BUTTERFLY VALVE', itemName: 'Wafer type butterfly valve DN100 PN10' }),
    master, rates, densities,
  )
  const bolts = res.lines.find((l) => l.part === 'Bolts')!
  const nuts = res.lines.find((l) => l.part === 'Nuts')!
  assert.equal(bolts.qty, 8)
  assert.equal(bolts.cost, r2(8 * 2 * 0.12 * 80)) // 153.60
  assert.equal(nuts.qty, 16)
  assert.equal(nuts.cost, r2(16 * 0.24 * 80)) // 307.20
})

test('standard: PN rating -> IS 1538, class rating -> ASME B16.5; no standards text -> assumed', () => {
  const both = [dn100, row({ rowIndex: 9, pnRatingClass: '150', standards: 'ASME B16.5', totalWeightKg: '4' })]
  assert.equal(computeCfSet(valve('100'), both, rates, densities).flangeRowIndex, 1)
  const cls = computeCfSet(valve('100', ['flange'], { pnRating: 'CLASS 150' }), both, rates, densities)
  assert.equal(cls.flangeRowIndex, 9)
  const noStd = computeCfSet(valve('100'), [row({ standards: null })], rates, densities)
  assert.equal(noStd.standardAssumed, true)
  assert.equal(noStd.lines.length, 4)
  // standards exist but none is IS 1538 -> missing, not silently another standard
  const other = computeCfSet(valve('100'), [row({ standards: 'BS 4504' })], rates, densities)
  assert.equal(other.lines.length, 0)
})

test('SS valve -> SS flange; item text SS -> SS fasteners; CAF gasket', () => {
  const ssRow = row({ rowIndex: 5, moc: 'SS', totalWeightKg: '3' })
  const res = computeCfSet(
    valve('100', ['flange'], { moc: 'STAINLESS STEEL', itemName: 'SS sluice valve with SS bolts and CAF gasket DN100 PN10' }),
    [ssRow], rates, densities,
  )
  assert.equal(res.lines[0].rateKey, 'SS')
  assert.equal(res.lines[0].cost, r2(2 * 3 * 300))
  assert.equal(res.lines[1].rateKey, 'SS')
  assert.equal(res.lines[3].rateKey, 'CAF')
})

test('cost warning: CF line with missing parts is flagged, a healthy one is not', () => {
  const base = { enquiryId: 'e', itemType: 'CF SET', moc: 'MS', size: '100', productCost: 500 }
  const w = evaluateCostWarnings([
    { ...base, id: 'bad', cfSetBreakdown: { missing: ['CF_FLANGE_RATE MS'] } },
    { ...base, id: 'ok', cfSetBreakdown: { missing: [] } },
    { ...base, id: 'valve', cfSetBreakdown: null },
  ])
  assert.ok(w.get('bad')?.includes(COST_WARNING.CF_SET_INCOMPLETE))
  assert.equal(w.get('ok'), undefined)
  assert.equal(w.get('valve'), undefined)
})

test('fastener MOC: "as per IS 1538" stays GI; AS / B7 text picks AS', () => {
  const k = (itemName: string) => computeCfSet(valve('100', ['flange'], { itemName }), master, { ...rates, fastener: { GI: 80, AS: 120 } }, densities).lines[1].rateKey
  assert.equal(k('CI sluice valve DN100 PN10 flanged as per IS 1538'), 'GI')
  assert.equal(k('Sluice valve DN100 PN10 with AS bolts'), 'AS')
  assert.equal(k('Sluice valve DN100 PN10 with B7 studs'), 'AS')
})
