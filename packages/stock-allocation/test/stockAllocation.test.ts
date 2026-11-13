import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateStock } from '../src/engine'
import { actKey } from '../src/parse'
import type { ContractLine, LedgerEntry, StockItem } from '../src/types'

let n = 0
const SLV_NAME = 'SLUICE VALVE-RESILIENT-NON-RISING_DUCTILE IRON/CAST IRON_STANDARD_65_PN-10/16_'

function stock(o: Partial<StockItem> = {}): StockItem {
  return {
    id: `s${++n}`, erpCode: 'FSD040050', location: 'KGP', valveType: 'SLUICE VALVE', dimension: '65MM',
    component: 'HW OP', material: 'DUCTILE IRON', std: 'STD', pn: 'PN-16',
    category: 'FINISHED VALVES', itemType: 'FINISHED / COMPLETE VALVE', availableQty: 5, ...o,
  }
}
function line(o: Partial<ContractLine> = {}): ContractLine {
  return {
    id: `l${++n}`, contractNo: 'C1', party: 'ABC Ltd', poNo: 'PO1', project: null, dateOfContract: '2-May-2024',
    itemCode: 'FSD040050', itemName: SLV_NAME, item: 'SLV', size: '65', pnRating: 'PN - 16', actuator: '',
    rate: 1000, balanceQty: 2, inspection: 'PENDING', offer: 'PENDING', ...o,
  }
}
const ledgerEntry = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `g${++n}`, erpCode: 'FSD040050', location: null, contractNo: 'C1', itemCode: 'FSD040050', qty: 1,
  source: 'manual', basis: null, remarks: null, allocatedAt: '2026-11-01T00:00:00Z', ...o,
})
const run = (stockRows: StockItem[], lines: ContractLine[], ledger: LedgerEntry[] = []) =>
  allocateStock({ stock: stockRows, lines, ledger })
// An ACTUATORS stock row: its model is L7 (pn) + L6 (std), the same pair a line stores as "L7@L6".
const actStock = (o: Partial<StockItem> = {}) => stock({
  erpCode: 'RAA010001', valveType: 'ACTUATOR', dimension: null, component: null, material: null,
  pn: 'K30/RPM24', std: 'WDAF87Z50CT6', category: 'ACTUATORS', itemType: null, ...o,
})
const actLine = (o: Partial<ContractLine> = {}) => line({ itemName: `${SLV_NAME}_ACT_`, actuator: 'K30/RPM24@WDAF87Z50CT6', ...o })
const held = (r: ReturnType<typeof run>, erpCode: string) => r.ledger.find((v) => v.erpCode === erpCode)

test('exact erp code is taken before other matching finished rows', () => {
  const other = stock({ erpCode: 'FSD040051' })
  const exact = stock({ erpCode: 'FSD040050' })
  const r = run([other, exact], [line()])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.deepEqual(r.offerNow[0].rmCodes.map((x) => x.erpCode), ['FSD040050'])
})

test('rows with #N/A erp code or zero qty are ignored', () => {
  const r = run([stock({ erpCode: '#N/A' }), stock({ availableQty: 0 })], [line()])
  assert.equal(r.offerNow.length, 0)
  assert.equal(r.notInStock[0].lines[0].shortQty, 2)
})

test('CS stock serves a DI sluice valve line with a flag, DI stock never serves a CS line', () => {
  const cs = stock({ material: 'CARBON STEEL/CAST STEEL' })
  const r = run([cs], [line()])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.ok(r.offerNow[0].flags.includes('CS offered against DI'))

  const csLine = line({ item: 'SLV RISING-CS', itemName: 'SLUICE VALVE CAST STEEL', balanceQty: 1 })
  assert.equal(run([stock({ std: 'RISING' })], [csLine]).offerNow.length, 0)
})

test('CS-for-DI substitution is sluice valves only', () => {
  const bfvLine = line({ item: 'BFV', itemName: 'BUTTERFLY VALVE DUCTILE IRON', itemCode: 'FBD1', balanceQty: 1 })
  const bfvCs = stock({ valveType: 'BUTTERFLY VALVE', material: 'CARBON STEEL/CAST STEEL', erpCode: 'FBD1' })
  assert.equal(run([bfvCs], [bfvLine]).offerNow.length, 0)
})

test('same material is preferred over CS-for-DI', () => {
  const cs = stock({ erpCode: 'FSD040051', material: 'CARBON STEEL/CAST STEEL' })
  const di = stock({ erpCode: 'FSD040052', material: 'CAST IRON' })
  const r = run([cs, di], [line({ itemCode: 'ZZZ', balanceQty: 1 })])
  assert.deepEqual(r.offerNow[0].rmCodes.map((x) => x.erpCode), ['FSD040052'])
  assert.deepEqual(r.offerNow[0].flags, [])
})

test('rising must match for sluice valves; STD counts as non-rising', () => {
  const rising = line({ item: 'SLV RISING-9523', itemName: 'SLUICE VALVE RISING', balanceQty: 1 })
  assert.equal(run([stock({ std: 'STD' })], [rising]).offerNow.length, 0)
  assert.equal(run([stock({ std: 'RISING' })], [line({ balanceQty: 1 })]).offerNow.length, 0)
  assert.equal(run([stock({ std: 'NON-RISING' })], [line({ balanceQty: 1 })]).offerNow.length, 1)
})

test('PN-25 stock serves a PN-16 line only up to DN80, and PN-16 stock goes first', () => {
  const pn25 = stock({ pn: 'PN-25', erpCode: 'FSD040060' })
  assert.equal(run([pn25], [line({ itemCode: 'ZZZ' })]).offerNow.length, 1)

  const big = line({ itemCode: 'ZZZ', size: '100' })
  assert.equal(run([stock({ pn: 'PN-25', dimension: '100MM' })], [big]).offerNow.length, 0)

  const r = run([pn25, stock({ erpCode: 'FSD040061' })], [line({ itemCode: 'ZZZ', balanceQty: 1 })])
  assert.deepEqual(r.offerNow[0].rmCodes.map((x) => x.erpCode), ['FSD040061'])
})

test('PN-20/25 lines take only PN-25 stock; CLASS lines only the same class', () => {
  const l25 = line({ pnRating: 'PN - 25', itemCode: 'ZZZ' })
  assert.equal(run([stock({ pn: 'PN-16' })], [l25]).offerNow.length, 0)
  assert.equal(run([stock({ pn: 'PN-25' })], [l25]).offerNow.length, 1)
  const cls = line({ pnRating: 'CLASS-150#', itemCode: 'ZZZ' })
  assert.equal(run([stock({ pn: 'PN-16' })], [cls]).offerNow.length, 0)
  assert.equal(run([stock({ pn: 'CLASS 150#' })], [cls]).offerNow.length, 1)
})

test('drilling 9523 lines take only -9523 stock, 1538 lines only plain stock', () => {
  const l9523 = line({ item: 'SLV RISING-9523', itemName: 'SLUICE VALVE RISING', itemCode: 'ZZZ' })
  assert.equal(run([stock({ std: 'RISING' })], [l9523]).offerNow.length, 0)
  assert.equal(run([stock({ std: 'RISING-9523' })], [l9523]).offerNow.length, 1)
  const l1538 = line({ itemName: `${SLV_NAME} IS 1538`, itemCode: 'ZZZ' })
  assert.equal(run([stock({ std: 'STD-9523' })], [l1538]).offerNow.length, 0)
  assert.equal(run([stock({ std: 'STD' })], [l1538]).offerNow.length, 1)
})

test('metal-seat lines need metal-to-metal stock', () => {
  const metal = line({ item: 'SLV METAL-9523', itemName: 'SLUICE VALVE METAL SEAT 9523', itemCode: 'ZZZ' })
  assert.equal(run([stock({ std: 'STD-9523', component: 'METAL TO RUBBER' })], [metal]).offerNow.length, 0)
  assert.equal(run([stock({ std: 'STD-9523', component: 'METAL TO METAL' })], [metal]).offerNow.length, 1)
  // sluice stock that says nothing about seat is resilient
  assert.equal(run([stock({ std: 'STD-9523', component: 'HW OP' })], [metal]).offerNow.length, 0)
})

test('seat is not checked when the stock row does not record one (check valves)', () => {
  const nrv = line({ item: 'NRV', itemName: 'Non Return Valve Ductile Iron Metal Seated PN - 1.6 Auto Op. 50 MM', itemCode: 'FCG010015', size: '50' })
  const swing = stock({ erpCode: 'FCG010015', valveType: 'CHECK VALVE', dimension: '50MM', component: 'DISC', std: 'SWING TYPE' })
  assert.equal(run([swing], [nrv]).offerNow[0]?.offerableQty, 2)
})

test('TPAV+SLV needs both a TPAV and a sluice valve; qty is the smaller of the two', () => {
  const pair = line({
    item: 'TPAV+SLV', itemCode: 'FTD050005', size: '40', pnRating: 'PN - 10', balanceQty: 4,
    itemName: 'Tamper Proof Air Valve With Isolation Sluice Valve Ductile Iron R S PN -1.0 Auto + HW OP 40 MM',
  })
  const tpav = stock({ erpCode: 'FTD050005', valveType: 'TPAV', dimension: '40MM', availableQty: 3 })
  const slv = stock({ erpCode: 'FSD040040', dimension: '40MM', availableQty: 5 })
  const r = run([tpav, slv], [pair])
  assert.equal(r.offerNow[0].offerableQty, 3)
  assert.equal(r.allocations.length, 2)
  assert.equal(r.allocations.every((a) => a.qty === 3), true)
  assert.equal(run([tpav], [pair]).offerNow.length, 0)
  assert.equal(run([tpav], [pair]).notInStock[0].lines[0].shortQty, 4)

  // a part already held by the ledger gets the other part on top
  const booked = run([stock({ ...tpav, availableQty: 2 }), slv], [pair], [ledgerEntry({ erpCode: 'FTD050005', itemCode: 'FTD050005', qty: 2 })])
  assert.equal(booked.offerNow[0]?.offerableQty, 2)
  assert.equal(held(booked, 'FSD040040')?.allocatedQty, 2)
})

test('actuated lines take the valve and the actuator model named in their Actuator field', () => {
  const r = run([stock(), actStock()], [actLine()])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.deepEqual(r.offerNow[0].rmCodes.map((x) => `${x.erpCode}×${x.qty}`).sort(), ['FSD040050×2', 'RAA010001×2'])
  assert.equal(r.offerNow[0].basis, 'Actuator to map') // stored value; shown as "With actuator"
  assert.deepEqual(r.offerNow[0].flags, ['actuator held from stock'])
  assert.equal(r.summary.actuator, 2000)
  assert.equal(r.summary.actuatorLines, 1)
  // an actuator row never serves as a valve, and the line takes no more actuators than valves
  assert.equal(run([actStock({ valveType: 'SLUICE VALVE', dimension: '65MM' })], [line()]).offerNow.length, 0)
  assert.equal(held(run([stock({ availableQty: 1 }), actStock()], [actLine()]), 'RAA010001')?.allocatedQty, 1)
})

test('actuator model matches whatever the order and case of its two parts', () => {
  assert.equal(actKey(' k30/rpm24', 'WDAF87Z50CT6 '), actKey('WDAF87Z50CT6', 'K30/RPM24'))
  assert.equal(actKey('K30/RPM24', ''), null)
  assert.equal(actKey('K30/RPM24', undefined), null)
  const reversed = actLine({ actuator: 'wdaf87z50ct6@k30/rpm24' })
  assert.equal(run([stock(), actStock()], [reversed]).offerNow[0]?.offerableQty, 2)
  // stock that keeps the two parts the other way round
  assert.equal(run([stock(), actStock({ pn: 'WDAF87Z50CT6', std: 'K30/RPM24' })], [actLine()]).offerNow[0]?.offerableQty, 2)
})

test('an actuated line with no matching actuator in stock does not hold its valve', () => {
  const act = actLine({ contractNo: 'ACT', balanceQty: 1, dateOfContract: '2-May-2024' })
  const plain = line({ contractNo: 'PLAIN', balanceQty: 1, dateOfContract: '30-Sep-2025' })
  const r = run([stock({ availableQty: 1 }), actStock({ pn: 'K40/RPM24' })], [act, plain])
  assert.deepEqual(r.offerNow.map((o) => o.line.contractNo), ['PLAIN'])
  assert.equal(r.notInStock.find((c) => c.contractNo === 'ACT')?.lines[0].shortQty, 1)
  assert.equal(held(r, 'RAA010001')?.allocatedQty, 0)
})

test('one actuator in stock serves one line; the other line leaves its valve free', () => {
  const a = actLine({ contractNo: 'A', balanceQty: 1, dateOfContract: '2-May-2024' })
  const b = actLine({ contractNo: 'B', balanceQty: 1, dateOfContract: '30-Sep-2025' })
  const r = run([stock({ availableQty: 2 }), actStock({ availableQty: 1 })], [b, a])
  assert.deepEqual(r.offerNow.map((o) => o.line.contractNo), ['A'])
  assert.equal(held(r, 'FSD040050')?.freeBalance, 1)
  assert.equal(held(r, 'RAA010001')?.freeBalance, 0)
})

test('a line locked by Offer sent keeps its valve and gets the actuator added on top', () => {
  const l = actLine({ balanceQty: 2 })
  const locked = ledgerEntry({ source: 'locked', basis: 'Actuator to map', qty: 2 })
  const r = run([stock({ availableQty: 2 }), actStock()], [l], [locked])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.equal(r.offerNow[0].offerSent, true)
  assert.deepEqual(r.allocations.map((a) => `${a.erpCode}:${a.source}:${a.qty}`).sort(), ['FSD040050:locked:2', 'RAA010001:auto:2'])
})

test('a locked line with no actuator free keeps its valve and stays in Offer Now at 0, so the lock can be released', () => {
  const locked = ledgerEntry({ source: 'locked', basis: 'Actuator to map', qty: 2 })
  const bare = run([stock({ availableQty: 2 })], [actLine({ balanceQty: 2 })], [locked])
  assert.deepEqual(bare.offerNow.map((o) => [o.offerableQty, o.offerValue, o.offerSent]), [[0, 0, true]])
  assert.deepEqual(bare.offerNow[0].flags, []) // no actuator held, so no flag saying so
  assert.equal(bare.summary.actuatorLines, 0) // not ready: no tile counts it
  assert.equal(held(bare, 'FSD040050')?.allocatedQty, 2)
  assert.equal(bare.notInStock[0].lines[0].shortQty, 2)
})

test('an Actuator field without "@" (-, NA, #N/A, MANUAL) is a placeholder: the line needs only its valve', () => {
  for (const actuator of ['-', 'NA', '#N/A', 'MANUAL']) {
    const r = run([stock()], [line({ actuator })])
    assert.equal(r.offerNow[0]?.offerableQty, 2, actuator)
    assert.equal(r.offerNow[0]?.basis, 'Finished', actuator)
  }
})

test('an actuated line with a blank Actuator field stays not ready and holds nothing', () => {
  const r = run([stock(), actStock()], [actLine({ actuator: '' })]) // actuated by the _ACT_ in its name
  assert.equal(r.offerNow.length, 0)
  assert.equal(r.allocations.length, 0)
})

test('an actuator alone never makes a line ready', () => {
  const gate = actLine({ item: 'GATE VALVE', itemName: 'GATE VALVE_ACT_', itemCode: 'XYZ' })
  assert.equal(run([actStock()], [gate]).offerNow.length, 0)
})

test('assemble stock is used for pending lines only, as spare', () => {
  const spare = stock({
    erpCode: 'RXA010001', category: 'SPARES', itemType: 'SPARE PARTS/ PARTS', component: 'LIGHT BBD',
  })
  const pending = run([spare], [line({ itemCode: 'ZZZ' })])
  assert.equal(pending.offerNow[0].basis, 'Assemble')
  assert.equal(pending.offerNow[0].rmCodes[0].spare, true)
  assert.equal(pending.summary.assemble, 2000)

  const inspected = run([spare], [line({ itemCode: 'ZZZ', inspection: 'DONE' })])
  assert.equal(inspected.offerNow.length, 0)
  const offered = run([spare], [line({ itemCode: 'ZZZ', offer: 'DONE' })])
  assert.equal(offered.offerNow.length, 0)
})

test('finished stock is taken before assemble stock', () => {
  const spare = stock({ erpCode: 'RXA010001', category: 'SPARES', itemType: 'SPARE PARTS/ PARTS', component: 'LIGHT BBD' })
  const fin = stock({ erpCode: 'FSD040051' })
  const r = run([spare, fin], [line({ itemCode: 'ZZZ', balanceQty: 1 })])
  assert.equal(r.offerNow[0].basis, 'Finished')
})

test('priority: inspection done, then offer done, then oldest pending', () => {
  const one = [stock({ availableQty: 1 })]
  const mk = (o: Partial<ContractLine>) => line({ balanceQty: 1, ...o })
  const pendOld = mk({ contractNo: 'OLD', dateOfContract: '2-May-2024' })
  const pendNew = mk({ contractNo: 'NEW', dateOfContract: '30-Sep-2025' })
  const offerDone = mk({ contractNo: 'OFR', offer: 'DONE', dateOfContract: '30-Sep-2025' })
  const insp = mk({ contractNo: 'INS', inspection: 'DONE', dateOfContract: '30-Sep-2025' })
  const winner = (lines: ContractLine[]) => run(one, lines).allocations.map((a) => `${a.contractNo}:${a.stage}`)

  assert.deepEqual(winner([pendOld, pendNew]), ['OLD:Booked'])
  assert.deepEqual(winner([pendNew, pendOld]), ['OLD:Booked'])
  assert.deepEqual(winner([pendOld, offerDone]), ['OFR:Offered'])
  assert.deepEqual(winner([pendOld, offerDone, insp]), ['INS:Inspection done'])
})

test('lines of the same date (or both undated) compete in id order, whatever order they arrive in', () => {
  for (const dateOfContract of ['2-May-2024', null]) {
    const a = line({ id: 'a', contractNo: 'A', balanceQty: 1, dateOfContract })
    const b = line({ id: 'b', contractNo: 'B', balanceQty: 1, dateOfContract })
    const winner = (lines: ContractLine[]) => run([stock({ availableQty: 1 })], lines).offerNow.map((o) => o.line.contractNo)
    assert.deepEqual(winner([a, b]), ['A'], String(dateOfContract))
    assert.deepEqual(winner([b, a]), ['A'], String(dateOfContract))
  }
})

test('ready qty never exceeds the balance, even when a booking holds more', () => {
  const r = run([stock()], [line({ balanceQty: 2 })], [ledgerEntry({ qty: 5 })])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.equal(r.offerNow[0].offerValue, 2000)
  assert.equal(r.summary.finished, 2000)
})

test('free balance never goes below zero', () => {
  const r = run([stock({ availableQty: 2 })], [line({ contractNo: 'A', balanceQty: 3 }), line({ contractNo: 'B', balanceQty: 3 })])
  assert.equal(r.allocations.reduce((s, a) => s + a.qty, 0), 2)
  assert.equal(r.ledger[0].freeBalance, 0)
  assert.equal(r.ledger[0].allocatedQty, 2)
  assert.equal(r.summary.short, 4000)
  assert.equal(r.notInStock.length, 2)
})

test('ledger entries are honoured before any automatic allocation', () => {
  const older = line({ contractNo: 'OLD', balanceQty: 1, dateOfContract: '2-May-2024' })
  const newer = line({ contractNo: 'NEW', balanceQty: 1, dateOfContract: '30-Sep-2025' })
  const r = run([stock({ availableQty: 1 })], [older, newer], [ledgerEntry({ contractNo: 'NEW', qty: 1 })])
  assert.deepEqual(r.allocations.map((a) => `${a.contractNo}:${a.source}`), ['NEW:manual'])
  assert.equal(r.offerNow[0].line.contractNo, 'NEW')
  assert.equal(r.notInStock[0].contractNo, 'OLD')
})

test('a locked ledger entry makes the line offerSent and carries its remarks', () => {
  const l = line({ balanceQty: 1 })
  const e = ledgerEntry({ source: 'locked', basis: 'Finished', remarks: 'sent 4 Nov' })
  const r = run([stock()], [l], [e])
  assert.equal(r.offerNow[0].offerSent, true)
  assert.equal(r.offerNow[0].remarks, 'sent 4 Nov')
  assert.equal(r.allocations[0].source, 'locked')
  assert.equal(run([stock()], [l]).offerNow[0].offerSent, false)
})

test('ledger entry for a closed line is Dispatched and takes no stock', () => {
  const closed = line({ balanceQty: 0 })
  const r = run([stock({ availableQty: 3 })], [closed], [ledgerEntry({ qty: 2 })])
  assert.equal(r.allocations[0].stage, 'Dispatched')
  assert.equal(r.ledger[0].allocatedQty, 0)
  assert.equal(r.ledger[0].freeBalance, 3)
  assert.equal(r.offerNow.length, 0)
})

test('lines with balance zero are skipped and unstocked item types are short', () => {
  const closed = line({ balanceQty: 0 })
  const noStock = line({ item: 'GATE VALVE', itemName: 'GATE VALVE', itemCode: 'XYZ', balanceQty: 3, rate: 10 })
  const r = run([stock()], [closed, noStock])
  assert.equal(r.offerNow.length, 0)
  assert.equal(r.notInStock[0].shortValue, 30)
})
