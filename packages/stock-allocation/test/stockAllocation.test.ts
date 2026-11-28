import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateStock } from '../src/engine'
import { actKey } from '../src/parse'
import { buildPurchaseInputs } from '../src/purchaseAllocation'
import { readyToBillExport } from '../src/readyToBill'
import type { PurchaseAllocationInput, AllocationInputs, AllocationResult, ContractLine, LedgerEntry, StockItem } from '../src/types'

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
const runIn = (stockRows: StockItem[], lines: ContractLine[], inputs: AllocationInputs, ledger: LedgerEntry[] = []) =>
  allocateStock({ stock: stockRows, lines, ledger, ...inputs })
/** The per-line output for one Contract Review line id. */
const out = (r: AllocationResult, id: string) => r.lines.find((x) => x.id === id)!
/** "Offer sent" as the page does it (ledger.ts lockOffer): one locked row per RM code the line holds. */
const lockAll = (r: AllocationResult, id: string): LedgerEntry[] => {
  const o = r.offerNow.find((x) => x.line.id === id)!
  return o.rmCodes.map((x) => ledgerEntry({
    erpCode: x.erpCode, location: x.location, contractNo: o.line.contractNo, itemCode: o.line.itemCode, qty: x.qty, source: 'locked', basis: o.basis,
  }))
}
const partRow = (erpCode: string, availableQty: number) => stock({ erpCode, component: 'PART', category: 'SPARES', itemType: null, availableQty })

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
  assert.ok(!r.offerNow[0].flags.includes('CS offered against DI'))
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
  assert.ok(run([pn25], [line({ itemCode: 'ZZZ' })]).offerNow[0].flags.includes('PN-25 offered against PN-16'))

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

test('a spare row (LIGHT BBD, RXA, spares) is never a whole valve on its own', () => {
  const spare = stock({ erpCode: 'RXA010001', category: 'SPARES', itemType: 'SPARE PARTS/ PARTS', component: 'LIGHT BBD' })
  const r = run([spare], [line({ itemCode: 'ZZZ' })])
  assert.equal(r.allocations.length, 0)
  assert.equal(r.offerNow.length, 0)
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

// ---- 18 Nov 2026 rules (Puja Agarwal) ----

// Ledger bookings and locks, a booking on a closed line, inspected / offered / pending lines, an actuator, a BFV,
// an unstocked type and a #N/A row: none of the 18 Nov rules bite here.
function before18Nov() {
  const l = (id: string, contractNo: string, o: Partial<ContractLine> = {}) => line({ id, contractNo, ...o })
  const stockRows = [
    stock({ id: 's1', availableQty: 6 }),
    stock({ id: 's2', location: 'BALTIKURI', availableQty: 2 }),
    stock({ id: 's3', erpCode: 'FBD010200', valveType: 'BUTTERFLY VALVE', dimension: '200MM', availableQty: 3 }),
    actStock({ id: 's4', availableQty: 2 }),
    stock({ id: 's5', erpCode: '#N/A', availableQty: 9 }),
  ]
  const lines = [
    l('l1', 'INS', { inspection: 'DONE', balanceQty: 2, dateOfContract: '30-Sep-2025' }),
    l('l2', 'OFR', { offer: 'DONE', balanceQty: 1, dateOfContract: '30-Sep-2025' }),
    l('l3', 'OLD', { balanceQty: 3, dateOfContract: '1-Jan-2025' }),
    actLine({ id: 'l4', contractNo: 'ACT', balanceQty: 1, dateOfContract: '5-Mar-2025' }),
    l('l5', 'BFV', { item: 'BFV', itemName: 'BUTTERFLY VALVE DUCTILE IRON', itemCode: 'FBD010200', size: '200', balanceQty: 2, rate: 500 }),
    l('l6', 'GATE', { item: 'GATE VALVE', itemName: 'GATE VALVE', itemCode: 'XYZ', balanceQty: 4, rate: 10 }),
    l('l7', 'SHUT', { balanceQty: 0 }),
  ]
  const ledger = [
    ledgerEntry({ id: 'g1', location: 'BALTIKURI', contractNo: 'OLD' }),
    ledgerEntry({ id: 'g2', contractNo: 'OFR', source: 'locked', basis: 'Finished', remarks: 'sent', allocatedAt: '2026-11-02T00:00:00Z' }),
    ledgerEntry({ id: 'g3', contractNo: 'SHUT', qty: 2, allocatedAt: '2026-10-01T00:00:00Z' }),
  ]
  return run(stockRows, lines, ledger)
}

test('no inputs and none of the new rules in play: the same result as before the 18 Nov rules', () => {
  const r = before18Nov()
  const a = (o: Record<string, unknown>) => ({
    erpCode: 'FSD040050', location: 'KGP', itemCode: 'FSD040050', party: 'ABC Ltd', poNo: 'PO1', stage: 'Booked',
    basis: 'Finished', source: 'auto', ledgerId: null, spare: false, flags: [], allocatedAt: null, ...o,
  })
  const ready = (id: string, qty: number, value: number, rmCodes: { erpCode: string; location: string; qty: number }[], o = {}) =>
    ({ id, offerableQty: qty, offerValue: value, rmCodes: rmCodes.map((x) => ({ ...x, spare: false })), basis: 'Finished', flags: [], offerSent: false, remarks: null, ...o })
  const desc = 'SLUICE VALVE 65MM HW OP DUCTILE IRON STD PN-16'
  // captured from the engine as it stood before the 18 Nov rules
  assert.deepEqual({
    allocations: r.allocations,
    offerNow: r.offerNow.map(({ line: { id }, ...o }) => ({ id, ...o })),
    ledger: r.ledger,
    notInStock: r.notInStock.map((c) => ({ ...c, lines: c.lines.map(({ line: { id }, ...x }) => ({ id, ...x })) })),
    summary: r.summary,
  }, {
    allocations: [
      a({ stockId: 's1', location: null, contractNo: 'SHUT', poNo: null, qty: 2, stage: 'Dispatched', source: 'manual', ledgerId: 'g3', allocatedAt: '2026-10-01T00:00:00Z' }),
      a({ stockId: 's2', location: 'BALTIKURI', contractNo: 'OLD', qty: 1, source: 'manual', ledgerId: 'g1', allocatedAt: '2026-11-01T00:00:00Z' }),
      a({ stockId: 's1', contractNo: 'OFR', qty: 1, stage: 'Offered', source: 'locked', ledgerId: 'g2', allocatedAt: '2026-11-02T00:00:00Z' }),
      a({ stockId: 's1', contractNo: 'INS', qty: 2, stage: 'Inspection done' }),
      a({ stockId: 's3', erpCode: 'FBD010200', contractNo: 'BFV', itemCode: 'FBD010200', qty: 2 }),
      a({ stockId: 's1', contractNo: 'OLD', qty: 2 }),
      a({ stockId: 's1', contractNo: 'ACT', qty: 1, basis: 'Actuator to map' }),
      a({ stockId: 's4', erpCode: 'RAA010001', contractNo: 'ACT', qty: 1, basis: 'Actuator to map', flags: ['actuator held from stock'] }),
    ],
    offerNow: [
      ready('l1', 2, 2000, [{ erpCode: 'FSD040050', location: 'KGP', qty: 2 }]),
      ready('l2', 1, 1000, [{ erpCode: 'FSD040050', location: 'KGP', qty: 1 }], { offerSent: true, remarks: 'sent' }),
      ready('l3', 3, 3000, [{ erpCode: 'FSD040050', location: 'BALTIKURI', qty: 1 }, { erpCode: 'FSD040050', location: 'KGP', qty: 2 }]),
      ready('l4', 1, 1000, [{ erpCode: 'FSD040050', location: 'KGP', qty: 1 }, { erpCode: 'RAA010001', location: 'KGP', qty: 1 }],
        { basis: 'Actuator to map', flags: ['actuator held from stock'] }),
      ready('l5', 2, 1000, [{ erpCode: 'FBD010200', location: 'KGP', qty: 2 }]),
    ],
    ledger: [
      { erpCode: 'FSD040050', location: 'KGP', availableQty: 6, allocatedQty: 6, freeBalance: 0, description: desc, allocatedTo: [
        { contractNo: 'OFR', itemCode: 'FSD040050', qty: 1, stage: 'Offered' }, { contractNo: 'INS', itemCode: 'FSD040050', qty: 2, stage: 'Inspection done' },
        { contractNo: 'OLD', itemCode: 'FSD040050', qty: 2, stage: 'Booked' }, { contractNo: 'ACT', itemCode: 'FSD040050', qty: 1, stage: 'Booked' }] },
      { erpCode: 'FSD040050', location: 'BALTIKURI', availableQty: 2, allocatedQty: 1, freeBalance: 1, description: desc,
        allocatedTo: [{ contractNo: 'OLD', itemCode: 'FSD040050', qty: 1, stage: 'Booked' }] },
      { erpCode: 'FBD010200', location: 'KGP', availableQty: 3, allocatedQty: 2, freeBalance: 1, description: 'BUTTERFLY VALVE 200MM HW OP DUCTILE IRON STD PN-16',
        allocatedTo: [{ contractNo: 'BFV', itemCode: 'FBD010200', qty: 2, stage: 'Booked' }] },
      { erpCode: 'RAA010001', location: 'KGP', availableQty: 2, allocatedQty: 1, freeBalance: 1, description: 'ACTUATOR WDAF87Z50CT6 K30/RPM24',
        allocatedTo: [{ contractNo: 'ACT', itemCode: 'FSD040050', qty: 1, stage: 'Booked' }] },
    ],
    notInStock: [{ contractNo: 'GATE', party: 'ABC Ltd', shortValue: 40, lines: [{ id: 'l6', shortQty: 4, shortValue: 40 }] }],
    summary: { finished: 7000, assemble: 0, actuator: 1000, short: 40, finishedLines: 4, assembleLines: 0, actuatorLines: 1 },
  })
})

test('one output line per live order line, keyed by its Contract Review id', () => {
  const r = before18Nov()
  assert.deepEqual(r.lines.map((x) => `${x.id}:${x.balanceToOffer}:${x.fgQty}:${x.shortfall}:${x.status}`), [
    'l1:0:0:0:Fully offered', // inspection DONE and no offered qty from the host: wholly offered, as before
    'l2:0:0:0:Fully offered',
    'l3:3:3:0:Ready for inspection call',
    'l4:1:1:0:Ready for inspection call',
    'l5:2:2:0:Ready for inspection call',
    'l6:4:0:4:Not available',
  ])
  assert.deepEqual(out(r, 'l4'), {
    id: 'l4', balanceToOffer: 1, fgQty: 1, rmRouteQty: 0, incomingQty: 0, eta: null, shortfall: 0, status: 'Ready for inspection call',
    actuatorFree: 1, gbFree: null, flags: ['actuator held from stock'], sources: [], suggestions: [],
  })
})

test('priority: Kalpataru UP, then Kalpataru MP, then the rest by oldest MC date; Blue Star is left out', () => {
  const one = () => [stock({ availableQty: 1 })]
  const mk = (id: string, o: Partial<ContractLine>) => line({ id, contractNo: id, balanceQty: 1, ...o })
  const rest = mk('REST', { mcDate: '1-Jan-2024' })
  const mp = mk('MP', { party: 'KALPATARU PROJECTS INTERNATIONAL LIMITED', state: 'MADHYA PRADESH', mcDate: '1-Jun-2026' })
  const up = mk('UP', { party: 'Kalpataru Projects International Ltd', state: 'up', mcDate: '1-Oct-2026' })
  const blue = mk('BLUE', { party: 'BLUE STAR LIMITED', mcDate: '1-Jan-2020' })
  const winner = (lines: ContractLine[]) => run(one(), lines).allocations.map((a) => a.contractNo)
  assert.deepEqual(winner([rest, mp, up]), ['UP'])
  assert.deepEqual(winner([rest, mp]), ['MP'])
  assert.deepEqual(winner([blue, rest]), ['REST'])
  const r = run(one(), [blue])
  assert.equal(r.allocations.length, 0)
  assert.equal(out(r, 'BLUE').status, 'Blue Star - left out for now')
  assert.equal(r.notInStock.length, 0)
  // stock already offered or inspected stays theirs (never allocated twice); only new allocation leaves them out
  assert.deepEqual(winner([{ ...blue, inspection: 'DONE' }, rest]), ['BLUE'])
  // Kalpataru outside UP / MP queues with the rest
  assert.deepEqual(winner([mk('KO', { party: 'KALPATARU', state: 'ODISHA', mcDate: '1-Oct-2026' }), rest]), ['REST'])
  // the rest: oldest MC date first; a blank MC date goes after every real one (undated = newest), then by contract date
  const newer = mk('NEW', { mcDate: '1-Mar-2026', dateOfContract: '1-Jan-2020' })
  const older = mk('OLD', { mcDate: '1-Feb-2026', dateOfContract: '1-Jan-2025' })
  assert.deepEqual(winner([newer, older]), ['OLD'])
  assert.deepEqual(winner([mk('NOMC', { dateOfContract: '1-Jan-2015' }), newer]), ['NEW'])
  assert.deepEqual(winner([mk('B1', { dateOfContract: '1-Jan-2025' }), mk('B2', { dateOfContract: '1-Jan-2024' })]), ['B2'])
})

test('MC-received lines are served first; an MC-pending line can hold stock but is never ready for an inspection call', () => {
  const pend = line({ id: 'P', contractNo: 'P', balanceQty: 1, mcPending: true, party: 'KALPATARU', state: 'UTTAR PRADESH', dateOfContract: '1-Jan-2020' })
  const recv = line({ id: 'R', contractNo: 'R', balanceQty: 1, mcDate: '1-Nov-2026' })
  assert.deepEqual(run([stock({ availableQty: 1 })], [pend, recv]).allocations.map((a) => a.contractNo), ['R'])
  const r = run([stock({ availableQty: 2 })], [pend, recv])
  assert.deepEqual([out(r, 'P').fgQty, out(r, 'P').status], [1, 'MC pending - stock held'])
  assert.equal(out(r, 'R').status, 'Ready for inspection call')
  assert.deepEqual(r.offerNow.map((o) => o.line.id), ['R']) // no MC yet: nothing to offer
  const none = run([], [pend])
  assert.deepEqual([out(none, 'P').shortfall, out(none, 'P').status], [1, 'Not available'])
  assert.equal(none.notInStock.length, 0) // Not in Stock keeps to MC-received lines
  assert.equal(out(run([stock({ availableQty: 1 })], [{ ...pend, balanceQty: 2 }]), 'P').status, 'Partial')
})

test('qty offered but not billed holds its stock first; balance to offer = MC qty − qty offered', () => {
  // A: MC 10, offered 6, billed 2 -> 4 offered and not billed, 4 still to offer. B: older, nothing offered.
  const a = line({ id: 'A', contractNo: 'A', balanceQty: 8, mcQty: 10, billedQty: 2, dateOfContract: '1-Jan-2026' })
  const b = line({ id: 'B', contractNo: 'B', balanceQty: 3, mcQty: 3, dateOfContract: '1-Jan-2020' })
  const r = runIn([stock({ availableQty: 6 })], [a, b], { offered: { A: 6, B: 0 } })
  assert.deepEqual(r.allocations.map((x) => `${x.contractNo}:${x.qty}`), ['A:4', 'B:2'])
  assert.deepEqual([out(r, 'A').balanceToOffer, out(r, 'A').fgQty, out(r, 'A').status], [4, 0, 'Not available'])
  assert.deepEqual([out(r, 'B').balanceToOffer, out(r, 'B').fgQty, out(r, 'B').shortfall, out(r, 'B').status], [3, 2, 1, 'Partial'])
  // everything offered: nothing left to offer
  assert.equal(out(runIn([stock()], [a], { offered: { A: 10 } }), 'A').status, 'Fully offered')
  // no offered qty from the host for a line: Offer / Inspection DONE still means wholly offered, as before
  const done = line({ id: 'D', contractNo: 'D', offer: 'DONE', balanceQty: 2, dateOfContract: '1-Jan-2026' })
  const r2 = runIn([stock({ availableQty: 2 })], [b, done], { offered: {} })
  assert.deepEqual(r2.allocations.map((x) => x.contractNo), ['D'])
  assert.equal(out(r2, 'D').status, 'Fully offered')
  // the MC register reads 0 while Contract Review says DONE (the register can lag): DONE still wins
  assert.equal(out(runIn([stock({ availableQty: 2 })], [done], { offered: { D: 0 } }), 'D').status, 'Fully offered')
})

test('holdings beyond the qty already offered read Booked, not the line\'s Offered / Inspection stage', () => {
  const a = line({ id: 'A', offer: 'DONE', balanceQty: 8, mcQty: 10, billedQty: 2 })
  const r = runIn([stock({ availableQty: 12 })], [a], { offered: { A: 6 } })
  assert.deepEqual(r.allocations.map((x) => `${x.qty}:${x.stage}`), ['4:Offered', '4:Booked'])
})

test('Offer Now and Ready to Bill count only what can be offered: offered-not-billed plus the balance to offer', () => {
  const r = runIn([stock({ availableQty: 9 })], [line({ id: 'A', balanceQty: 5, mcQty: 2 })], { offered: { A: 0 } })
  assert.deepEqual([out(r, 'A').balanceToOffer, r.offerNow[0].offerableQty, r.offerNow[0].offerValue], [2, 2, 2000])
  assert.equal(held(r, 'FSD040050')?.allocatedQty, 5) // the 3 awaiting their MC stay held
})

test('qty still awaiting an MC is held only after every MC-received balance and with the MC-pending lines', () => {
  // A: order 5, MC for 2 only; B: newer, fully MC'd
  const a = line({ id: 'A', contractNo: 'A', balanceQty: 5, mcQty: 2, dateOfContract: '1-Jan-2020' })
  const b = line({ id: 'B', contractNo: 'B', balanceQty: 3, mcQty: 3, dateOfContract: '1-Jan-2026' })
  const r = runIn([stock({ availableQty: 6 })], [a, b], { offered: { A: 0, B: 0 } })
  assert.deepEqual(r.allocations.map((x) => `${x.contractNo}:${x.qty}`), ['A:2', 'B:3', 'A:1'])
  assert.deepEqual([out(r, 'A').balanceToOffer, out(r, 'A').fgQty, out(r, 'A').status], [2, 2, 'Ready for inspection call'])
})

test('drilling: a line not naming 9523 is IS 1538; across standards nothing is allocated, only suggested as possible after machining', () => {
  const plain = line({ id: 'P', itemCode: 'ZZZ' })
  const r = run([stock({ erpCode: 'FSD040059', std: 'STD-9523' })], [plain])
  assert.equal(r.allocations.length, 0)
  assert.deepEqual(out(r, 'P').suggestions, [{ erpCode: 'FSD040059', qty: 2, note: 'possible after machining' }])
  assert.equal(out(r, 'P').status, 'Not available')
  const l9523 = line({ id: 'N', item: 'SLV-9523', itemName: `${SLV_NAME} IS 9523`, itemCode: 'ZZZ', balanceQty: 3 })
  const r2 = run([stock({ availableQty: 1 })], [l9523])
  assert.equal(r2.allocations.length, 0)
  assert.deepEqual(out(r2, 'N').suggestions, [{ erpCode: 'FSD040050', qty: 1, note: 'possible after machining' }])
  // stock of the right drilling: allocated, nothing suggested
  assert.deepEqual(out(run([stock()], [plain]), 'P').suggestions, [])
})

test('end connection: wafer stock serves only wafer lines, and the other way round', () => {
  const bfv = (itemName: string) => line({ item: 'BFV', itemName, itemCode: 'FBD1', size: '200', balanceQty: 1 })
  const bfvStock = (std: string) => stock({ erpCode: 'FBD1', valveType: 'BUTTERFLY VALVE', dimension: '200MM', std })
  const flanged = bfv('BUTTERFLY VALVE DUCTILE IRON'), wafer = bfv('BUTTERFLY VALVE WAFER TYPE DUCTILE IRON')
  assert.equal(run([bfvStock('WAFER TYPE')], [flanged]).allocations.length, 0)
  assert.equal(run([bfvStock('STD')], [wafer]).allocations.length, 0)
  assert.equal(run([bfvStock('WAFER TYPE')], [wafer]).allocations.length, 1)
  assert.equal(run([bfvStock('STD')], [flanged]).allocations.length, 1)
})

test('actuator: the approved model first; same model and RPM with other wiring only with a wiring change; any other never', () => {
  const otherWiring = actStock({ erpCode: 'RAA010002', std: 'WDXX0000' })
  const r = run([stock(), otherWiring], [actLine({ id: 'A' })])
  assert.equal(r.offerNow[0].offerableQty, 2)
  assert.ok(r.offerNow[0].flags.includes('allocated - wiring change required'))
  assert.equal(out(r, 'A').status, 'Allocated - wiring change required')
  const mixed = run([stock(), actStock({ availableQty: 1 }), otherWiring], [actLine()])
  assert.deepEqual(mixed.allocations.filter((a) => a.erpCode.startsWith('RAA')).map((a) => `${a.erpCode}:${a.qty}`), ['RAA010001:1', 'RAA010002:1'])
  // another RPM, or another model, is never allocated (and the valve stays free)
  assert.equal(run([stock(), actStock({ pn: 'K30/RPM48' })], [actLine()]).allocations.length, 0)
  assert.equal(run([stock(), actStock({ pn: 'K40/RPM24', std: 'WDXX0000' })], [actLine()]).allocations.length, 0)
  // stock keeping the two parts the other way round still reads model + RPM from the part saying RPM
  assert.equal(out(run([stock(), actStock({ pn: 'WDXX0000', std: 'K30/RPM24' })], [actLine({ id: 'B' })]), 'B').status, 'Allocated - wiring change required')
  // a rating that does not say RPM: model + RPM cannot be told from the wiring, so the exact model only
  const noRpm = actLine({ actuator: 'SA07@WD1' })
  assert.equal(run([stock(), actStock({ pn: 'SA07', std: 'WD2' })], [noRpm]).allocations.length, 0)
  assert.equal(run([stock(), actStock({ pn: 'SA07', std: 'WD1' })], [noRpm]).offerNow[0]?.offerableQty, 2)
})

test('"Offer sent" keeps the flags its allocation had: a locked wiring-change or PN-25 offer still says so', () => {
  const stockRows = [stock(), actStock({ erpCode: 'RAA010002', std: 'WDXX0000' })]
  const again = run(stockRows, [actLine({ id: 'A' })], lockAll(run(stockRows, [actLine({ id: 'A' })]), 'A'))
  assert.equal(again.offerNow[0].offerSent, true)
  assert.equal(out(again, 'A').status, 'Allocated - wiring change required')
  const pn25 = [stock({ pn: 'PN-25' })], p = line({ id: 'P', balanceQty: 1 })
  assert.deepEqual(out(run(pn25, [p], lockAll(run(pn25, [p]), 'P')), 'P').flags, ['PN-25 offered against PN-16'])
})

test('each line shows the free qty of its approved actuator and of its gearbox codes', () => {
  const gb = stock({ erpCode: 'RGB0001', valveType: 'GEAR BOX', dimension: null, category: 'GEAR BOX', itemType: null, availableQty: 4 })
  const r = run([stock(), actStock({ availableQty: 5 }), gb], [actLine({ id: 'A', rmCodeForGb: 'rgb0001, RGB0009' }), line({ id: 'P', balanceQty: 1 })])
  assert.deepEqual([out(r, 'A').actuatorFree, out(r, 'A').gbFree], [3, 4])
  assert.deepEqual([out(r, 'P').actuatorFree, out(r, 'P').gbFree], [null, null])
})

test('RM route: buildable qty is the scarcest major BOM part, drawn after finished stock and shown apart from it', () => {
  const part = (erpCode: string, component: string, availableQty: number) =>
    stock({ erpCode, component, category: 'SPARES', itemType: 'SPARE PARTS/ PARTS', availableQty })
  const bbd = part('RXA010001', 'LIGHT BBD', 7), set = part('RSS010001', 'NR SPARE SET', 5)
  const bom = [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 2 }] // 7 ÷ 1 = 7, 5 ÷ 2 = 2 -> 2
  const a = line({ id: 'A', contractNo: 'A', balanceQty: 6, dateOfContract: '1-Jan-2020' })
  const b = line({ id: 'B', contractNo: 'B', balanceQty: 6, dateOfContract: '1-Jan-2021' })
  const r = runIn([stock({ availableQty: 3 }), bbd, set], [a, b], { boms: { A: bom, B: bom } })
  assert.deepEqual([out(r, 'A').fgQty, out(r, 'A').rmRouteQty, out(r, 'A').shortfall, out(r, 'A').status], [3, 2, 1, 'Partial'])
  assert.deepEqual([out(r, 'B').fgQty, out(r, 'B').rmRouteQty, out(r, 'B').status], [0, 0, 'Not available']) // 1 spare set left
  // the parts are held for A, as spares, so the stock pages show them taken
  assert.deepEqual([held(r, 'RXA010001')?.allocatedQty, held(r, 'RSS010001')?.allocatedQty], [2, 4])
  assert.deepEqual(r.offerNow.map((o) => [o.line.id, o.offerableQty, o.basis]), [['A', 5, 'Assemble']])
  assert.ok(r.offerNow[0].rmCodes.some((x) => x.erpCode === 'RXA010001' && x.qty === 2 && x.spare))
  // no BOM, no RM route; codes never pool (no IS 9523 BBD in stock, the STD one is not used)
  assert.equal(out(run([bbd, set], [line({ id: 'C' })]), 'C').rmRouteQty, 0)
  const bom9523 = [{ erpCode: 'RXA019523', qty: 1 }, { erpCode: 'RSS010001', qty: 1 }]
  assert.equal(out(runIn([bbd, set], [line({ id: 'D' })], { boms: { D: bom9523 } }), 'D').rmRouteQty, 0)
})

test('a locked RM-route offer keeps its parts and takes no second set; the next line keeps its own', () => {
  const stockRows = [partRow('RXA010001', 4), partRow('RSS010001', 4)]
  const bom = [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 1 }]
  const lines = [line({ id: 'A', contractNo: 'A', dateOfContract: '1-Jan-2020' }), line({ id: 'B', contractNo: 'B', dateOfContract: '1-Jan-2021' })]
  const first = runIn(stockRows, lines, { boms: { A: bom, B: bom } })
  assert.deepEqual([out(first, 'A').rmRouteQty, out(first, 'B').rmRouteQty], [2, 2])
  const again = runIn(stockRows, lines, { boms: { A: bom, B: bom } }, lockAll(first, 'A'))
  assert.deepEqual([out(again, 'A').rmRouteQty, out(again, 'B').rmRouteQty], [2, 2])
  assert.equal(again.allocations.filter((x) => x.contractNo === 'A').reduce((s, x) => s + x.qty, 0), 4) // 2 BBD + 2 sets, not 4 + 4
  assert.deepEqual(again.offerNow.map((o) => [o.line.id, o.offerableQty, o.offerSent]), [['A', 2, true], ['B', 2, false]])
})

test('RM route of an actuated line: only as many valves as approved actuators it can get, held with the parts', () => {
  const stockRows = [partRow('RXA010001', 4), partRow('RSS010001', 4)]
  const boms = { A: [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 1 }] }
  const none = runIn(stockRows, [actLine({ id: 'A' })], { boms })
  assert.deepEqual([out(none, 'A').rmRouteQty, none.allocations.length, none.offerNow.length], [0, 0, 0])
  const one = runIn([...stockRows, actStock({ availableQty: 1 })], [actLine({ id: 'A' })], { boms })
  assert.equal(out(one, 'A').rmRouteQty, 1)
  assert.deepEqual(one.offerNow.map((o) => [o.offerableQty, o.basis]), [[1, 'Actuator to map']])
  assert.deepEqual([held(one, 'RAA010001')?.allocatedQty, held(one, 'RXA010001')?.allocatedQty], [1, 1])
  const wiring = runIn([...stockRows, actStock({ erpCode: 'RAA010002', std: 'WDXX0000' })], [actLine({ id: 'A' })], { boms })
  assert.equal(out(wiring, 'A').rmRouteQty, 2)
  assert.ok(out(wiring, 'A').flags.includes('allocated - wiring change required'))
})

test('N1: an actuated line whose item is not stocked counts its RM-route actuators as no finished valve', () => {
  const stockRows = [partRow('RXA010001', 4), partRow('RSS010001', 4), actStock({ availableQty: 2 })]
  const boms = { K: [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 1 }] }
  const k = actLine({ id: 'K', item: 'SLUICE GATE', itemName: 'SLUICE GATE_ACT_', balanceQty: 2 })
  const r = runIn(stockRows, [k], { boms })
  assert.deepEqual([out(r, 'K').fgQty, out(r, 'K').rmRouteQty, out(r, 'K').status], [0, 2, 'Partial'])
  const one = runIn([partRow('RXA010001', 1), partRow('RSS010001', 1), actStock({ availableQty: 2 })], [k], { boms })
  assert.deepEqual([out(one, 'K').fgQty, out(one, 'K').rmRouteQty, one.offerNow[0].offerableQty], [0, 1, 1])
})

test('N2: after a line\'s locked parts are built into valves, its locked parts do not also take finished valves', () => {
  // A and B each owed 2; "Offer sent" on A locked 2 + 2 parts; production built A's 2 valves from other parts
  const bom = [{ erpCode: 'RXA010001', qty: 1 }, { erpCode: 'RSS010001', qty: 1 }]
  const stockRows = [partRow('RXA010001', 2), partRow('RSS010001', 2), stock({ availableQty: 2 })]
  const lines = [line({ id: 'A', contractNo: 'A', dateOfContract: '1-Jan-2020' }), line({ id: 'B', contractNo: 'B', dateOfContract: '1-Jan-2021' })]
  const locks = [
    ledgerEntry({ erpCode: 'RXA010001', contractNo: 'A', qty: 2, source: 'locked', basis: 'Assemble' }),
    ledgerEntry({ erpCode: 'RSS010001', contractNo: 'A', qty: 2, source: 'locked', basis: 'Assemble' }),
  ]
  const r = runIn(stockRows, lines, { boms: { A: bom, B: bom } }, locks)
  assert.deepEqual([out(r, 'A').fgQty, out(r, 'A').rmRouteQty], [0, 2])
  assert.deepEqual([out(r, 'B').fgQty, out(r, 'B').status], [2, 'Ready for inspection call'])
})

test('N3: with the host\'s offered qty, a missing or lagging register reading falls back to the MC qty, not the whole line', () => {
  const done = line({ id: 'A', balanceQty: 5, mcQty: 2, offer: 'DONE' })
  const r = runIn([stock({ availableQty: 9 })], [done], { offered: { A: 0 } })
  assert.deepEqual([out(r, 'A').status, r.offerNow.length], ['Fully offered', 1])
  assert.equal(r.offerNow[0].offerableQty, 2)
  const pending = runIn([stock({ availableQty: 9 })], [line({ id: 'P', balanceQty: 5, mcQty: 2 })], { offered: {} })
  assert.deepEqual([out(pending, 'P').balanceToOffer, pending.offerNow[0].offerableQty], [2, 2])
})

test('stock under another FG code is used as is and flagged for a production entry', () => {
  const r = run([stock({ erpCode: 'FSD040051' })], [line({ id: 'A', balanceQty: 1 })])
  assert.deepEqual(r.offerNow[0].flags, ['production entry from FSD040051'])
  assert.deepEqual(out(r, 'A').flags, ['production entry from FSD040051'])
  assert.deepEqual(run([stock()], [line({ balanceQty: 1 })]).offerNow[0].flags, []) // its own code: no entry needed
})

test('incoming China shipments cover only what physical stock leaves short, earliest ETA first, never counted as physical', () => {
  const a = line({ id: 'A', contractNo: 'A', balanceQty: 5, dateOfContract: '1-Jan-2020' })
  const b = line({ id: 'B', contractNo: 'B', balanceQty: 4, dateOfContract: '1-Jan-2021' })
  const incoming = [
    { erpCode: 'FSD040050', qty: 4, eta: '15-Jan-2027' },
    { erpCode: 'fsd040050 ', qty: 2, eta: '10-Dec-2026' },
    { erpCode: 'FSD999999', qty: 9, eta: '1-Dec-2026' },
  ]
  const r = runIn([stock({ availableQty: 2 })], [a, b], { incoming })
  assert.deepEqual([out(r, 'A').fgQty, out(r, 'A').incomingQty, out(r, 'A').eta, out(r, 'A').shortfall, out(r, 'A').status], [2, 3, '15-Jan-2027', 0, 'Partial'])
  assert.deepEqual([out(r, 'B').fgQty, out(r, 'B').incomingQty, out(r, 'B').eta, out(r, 'B').shortfall, out(r, 'B').status], [0, 3, '15-Jan-2027', 1, 'Not available'])
  assert.equal(r.allocations.reduce((s, x) => s + x.qty, 0), 2)
  assert.deepEqual(r.offerNow.map((o) => o.offerableQty), [2])
})

const pa = (o: Partial<PurchaseAllocationInput> = {}): PurchaseAllocationInput => ({
  contractNo: 'C1', itemCode: 'FSD040050', erpCode: 'FSD040050', physicalQty: 0, incomingQty: 0, shortQty: 0, poNo: 'P1', poLineNo: '1',
  lot: 'L1', tinaInvoiceNo: 'T1', blNo: 'B1', eta: '15-Jan-2027', shipStatus: null, needsConfirmation: false, ...o,
})
const allocRow = (qty: number, o: Record<string, unknown> = {}) => ({
  id: 'a', poNo: 'P1', poLineNo: '1', contractNo: 'C1', itemCode: 'FSD040050', qty, lot: null, tinaInvoiceNo: null, blNo: null,
  eta: null, shipStatus: null, needsConfirmation: false, allocatedAt: '2026-11-01', ...o,
})

test('purchase: received qty is reserved on stock before auto-allocation, so an earlier line cannot take it', () => {
  const early = line({ id: 'E', contractNo: 'C0', balanceQty: 30, dateOfContract: '1-Jan-2024' })
  const mine = line({ id: 'M', balanceQty: 30 })
  const r = runIn([stock({ availableQty: 30 })], [early, mine], { purchaseAllocations: [pa({ physicalQty: 30 })] })
  assert.deepEqual([out(r, 'M').fgQty, out(r, 'E').fgQty], [30, 0])
  assert.deepEqual(out(r, 'M').sources.map((s) => [s.state, s.qty, s.poNo, s.lot]), [['received', 30, 'P1', 'L1']])
})

test('purchase: received qty missing from physical stock reserves what exists and flags the line', () => {
  const r = runIn([stock({ availableQty: 20 })], [line({ id: 'M', balanceQty: 30 })], { purchaseAllocations: [pa({ physicalQty: 30 })] })
  assert.equal(out(r, 'M').fgQty, 20)
  assert.ok(out(r, 'M').flags.includes('Received - not yet in stock'))
})

test('purchase: incoming qty shows on the line as incoming, ahead of the auto-incoming step', () => {
  const r = runIn([], [line({ id: 'M', balanceQty: 50 })], {
    purchaseAllocations: [pa({ incomingQty: 20 })], incoming: [{ erpCode: 'FSD040050', qty: 100, eta: '1-Mar-2027' }],
  })
  assert.deepEqual([out(r, 'M').incomingQty, out(r, 'M').shortfall], [50, 0])
  assert.deepEqual(out(r, 'M').sources.map((s) => [s.state, s.qty, s.eta]), [['incoming', 20, '15-Jan-2027']])
})

test('purchase: short receipt is flagged and stays in the shortfall', () => {
  const r = runIn([stock({ availableQty: 30 })], [line({ id: 'M', balanceQty: 40 })], { purchaseAllocations: [pa({ physicalQty: 30, shortQty: 10 })] })
  assert.deepEqual([out(r, 'M').fgQty, out(r, 'M').shortfall], [30, 10])
  assert.ok(out(r, 'M').flags.includes('Short receipt 10'))
  assert.deepEqual(out(r, 'M').sources.map((s) => s.state), ['received', 'short'])
})

test('purchase: needsConfirmation is carried onto the sources', () => {
  const r = runIn([], [line({ id: 'M', balanceQty: 5 })], { purchaseAllocations: [pa({ incomingQty: 5, needsConfirmation: true })] })
  assert.equal(out(r, 'M').sources[0].needsConfirmation, true)
})

test('purchase: Ready to Bill rows never carry purchase sources', () => {
  const r = runIn([stock({ availableQty: 3 })], [line({ id: 'M', balanceQty: 3 })], { purchaseAllocations: [pa({ physicalQty: 3 })] })
  const rows = readyToBillExport(r.offerNow, { page: 1, pageSize: 50, sort: null, search: '', filters: {} }, r.lines)
  assert.equal(rows.length, 1)
  assert.ok(!/L1|T1|B1|P1|15-Jan/.test(JSON.stringify(rows)))
})

test('buildPurchaseInputs: free incoming excludes what allocations claim (ordered 100, allocated 60 -> 40), never negative', () => {
  const b = buildPurchaseInputs(
    [{ poNo: 'P1', poLineNo: '1', itemCode: 'FSD040050', ordered: 100, received: 0, closed: false, eta: '1-Mar-2027' }], [allocRow(60)],
  )
  assert.deepEqual(b.incoming, [{ erpCode: 'FSD040050', qty: 40, eta: null }])
  assert.deepEqual([b.purchaseAllocations[0].incomingQty, b.views[0].freeBalance, b.views[0].pending], [60, 40, 100])
  const over = buildPurchaseInputs([{ poNo: 'P1', poLineNo: '1', itemCode: 'X', ordered: 10, received: 0, closed: false, eta: null }], [allocRow(30)])
  assert.deepEqual([over.incoming, over.views[0].freeBalance], [[], 0])
})

const pl = (o: Record<string, unknown> = {}) => ({ poNo: 'P1', poLineNo: '1', itemCode: 'FSD040050', ordered: 100, received: 0, closed: false, eta: '1-Mar-2027', ...o })

test('purchase end to end: ordered 100, allocated 60 -> the auto step sees only 40', () => {
  const b = buildPurchaseInputs([pl()], [allocRow(60)])
  const other = line({ id: 'O', contractNo: 'C9', balanceQty: 100, dateOfContract: '1-Jan-2027' })
  const r = runIn([], [line({ id: 'M', balanceQty: 60 }), other], { ...b })
  assert.equal(out(r, 'M').incomingQty, 60)
  assert.equal(out(r, 'O').incomingQty, 40)
})

test('purchase: incoming fed by a purchase line keeps the delivery date off line.eta, only on sources', () => {
  const b = buildPurchaseInputs([pl()], [allocRow(20, { eta: '15-Jan-2027' })])
  const other = line({ id: 'O', contractNo: 'C9', balanceQty: 30 })
  const r = runIn([], [line({ id: 'M', balanceQty: 20 }), other], { ...b })
  assert.equal(out(r, 'O').incomingQty, 30)
  assert.equal(out(r, 'O').eta, null)
  assert.equal(out(r, 'M').eta, null)
  assert.deepEqual(out(r, 'M').sources.map((s) => [s.state, s.eta]), [['incoming', '15-Jan-2027']])
  assert.ok(!JSON.stringify(b.incoming).includes('Mar-2027'))
})

test('purchase: over-receipt reserves the allocated qty, the extra is not auto-assigned as incoming', () => {
  const b = buildPurchaseInputs([pl({ received: 120, closed: true })], [allocRow(60)])
  assert.deepEqual([b.purchaseAllocations[0].physicalQty, b.purchaseAllocations[0].incomingQty, b.incoming], [60, 0, []])
  const r = runIn([stock({ availableQty: 120 })], [line({ id: 'M', balanceQty: 60 })], { ...b })
  assert.deepEqual([out(r, 'M').fgQty, out(r, 'M').incomingQty, out(r, 'M').shortfall], [60, 0, 0])
})

test('purchase: closed line with short receipt flags the shortage through the engine', () => {
  const b = buildPurchaseInputs([pl({ received: 40, closed: true })], [allocRow(60)])
  assert.deepEqual([b.purchaseAllocations[0].physicalQty, b.purchaseAllocations[0].shortQty, b.incoming], [40, 20, []])
  const r = runIn([stock({ availableQty: 40 })], [line({ id: 'M', balanceQty: 60 })], { ...b })
  assert.deepEqual([out(r, 'M').fgQty, out(r, 'M').shortfall], [40, 20])
  assert.ok(out(r, 'M').flags.includes('Short receipt 20'))
})

test('purchase: an allocation whose contract line is not live is released, the auto step sees the full pending', () => {
  const live = (a: { contractNo: string; itemCode: string }) => a.contractNo === 'C1'
  const b = buildPurchaseInputs([pl()], [allocRow(60, { contractNo: 'GONE' })], live)
  assert.deepEqual(b.incoming, [{ erpCode: 'FSD040050', qty: 100, eta: null }])
  assert.equal(b.purchaseAllocations.length, 0)
  const r = runIn([], [line({ id: 'M', balanceQty: 100 })], { ...b })
  assert.equal(out(r, 'M').incomingQty, 100)
  assert.deepEqual(out(r, 'M').flags, [])
})

test('purchase: null ordered qty shows pending as the allocated incoming, not 0', () => {
  const b = buildPurchaseInputs([pl({ ordered: 0 })], [allocRow(5)])
  assert.deepEqual([b.purchaseAllocations[0].incomingQty, b.views[0].pending, b.incoming], [5, 5, []])
})

test('purchase: two lines claiming the same received stock, the older allocation wins whatever the input order', () => {
  const mk = (id: string, cno: string, at: string) => pa({ id, allocatedAt: at, contractNo: cno, physicalQty: 30 })
  const a = mk('a1', 'C1', '2026-11-01T00:00:00Z'), b = mk('a2', 'C2', '2026-11-01T00:00:00Z'), c = mk('a0', 'C3', '2026-10-01T00:00:00Z')
  const ls = () => [line({ id: 'L1', contractNo: 'C1', balanceQty: 30 }), line({ id: 'L2', contractNo: 'C2', balanceQty: 30 }), line({ id: 'L3', contractNo: 'C3', balanceQty: 30 })]
  for (const order of [[a, b, c], [c, b, a], [b, a, c], [b, c, a]]) {
    const r = runIn([stock({ availableQty: 30 })], ls(), { purchaseAllocations: order })
    assert.deepEqual([out(r, 'L3').fgQty, out(r, 'L1').fgQty, out(r, 'L2').fgQty], [30, 0, 0])
  }
  // same timestamp: id breaks the tie
  for (const order of [[a, b], [b, a]]) {
    const r = runIn([stock({ availableQty: 30 })], ls().slice(0, 2), { purchaseAllocations: order })
    assert.deepEqual([out(r, 'L1').fgQty, out(r, 'L2').fgQty], [30, 0])
  }
})
