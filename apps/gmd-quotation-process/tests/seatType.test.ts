import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSeatType, categorySeat, seatMismatch } from '../lib/seatType.js'

const seat = (boq: string) => detectSeatType({ boq }).seat

test('metal seated and resilient keywords, any case', () => {
  for (const t of ['Metal Seated sluice valve', 'metal-seated', 'MS sluice valve', 'Gun metal seat rings', 'BRONZE SEAT'])
    assert.equal(seat(t), 'Metal seated', t)
  for (const t of ['Resilient seated', 'RS gate valve', 'rubber seated BFV', 'Soft Seated', 'EPDM lined', 'as per BS 5163', 'BS5163'])
    assert.equal(seat(t), 'Resilient', t)
})

test('MS and RS match only as whole words', () => {
  for (const t of ['SYSTEMS', 'PIPE MSC', 'VERSION 2', 'HRS', 'ABS 5163']) assert.equal(seat(t), null, t)
  assert.equal(seat('valve (RS)'), 'Resilient')
  assert.equal(seat('MS/DI body'), 'Metal seated')
})

test('a rupee amount is not RS', () => {
  assert.equal(seat('Sluice valve 150 mm Rs 500 each'), null)
  assert.equal(seat('Rate Rs. 1,200'), null)
})

test('inside one source the first keyword wins, with no flag', () => {
  assert.deepEqual(detectSeatType({ boq: 'EPDM gasket, metal seated' }), { seat: 'Resilient', source: 'BOQ', flag: null })
  assert.deepEqual(detectSeatType({ boq: 'metal seated, EPDM gasket' }), { seat: 'Metal seated', source: 'BOQ', flag: null })
})

test('priority: BOQ text, then item text, then docket spec', () => {
  assert.deepEqual(detectSeatType({ boq: 'Resilient sluice valve', itemText: 'metal seated', spec: 'MS' }), { seat: 'Resilient', source: 'BOQ', flag: null })
  assert.deepEqual(detectSeatType({ boq: 'Sluice valve 200 mm', itemText: 'metal seated', spec: 'resilient' }), { seat: 'Metal seated', source: 'ITEM', flag: null })
  assert.deepEqual(detectSeatType({ boq: 'Check valve', itemText: 'CHECK VALVE', spec: 'EPDM' }), { seat: 'Resilient', source: 'SPEC', flag: null })
})

test('nothing found: seat type unknown', () => {
  assert.deepEqual(detectSeatType({ boq: 'Butterfly valve 300 mm', itemText: null }), { seat: null, source: null, flag: 'seat type unknown' })
  assert.deepEqual(detectSeatType({}), { seat: null, source: null, flag: 'seat type unknown' })
})

test('docket line: the sluice item type carries its seat; merged details count as item text', () => {
  assert.equal(categorySeat({ itemType: 'SLUICE VALVE-METAL-NON-RISING' }), 'Metal seated')
  assert.equal(categorySeat({ itemType: 'SLUICE VALVE-RESILIENT-RISING' }), 'Resilient')
  assert.equal(categorySeat({ itemType: 'AIR VALVE', itemNameMerge: 'AIR VALVE-DI-80-PN10-WITH ISOLATION METAL SLUICE NON-RISING' }), 'Metal seated')
})

test('docket spec ignores bare MS / RS (mild steel, "Ms." signature, rupees) but keeps full seat words', () => {
  for (const spec of ['MS Pipe', 'Base frame- MS Fabricated', 'Ms. Puja Agarwal', 'RS 150 mm', 'MS FLAT'])
    assert.deepEqual(detectSeatType({ boq: 'NRV 250mm', itemText: 'CHECK VALVE', spec }), { seat: null, source: null, flag: 'seat type unknown' }, spec)
  assert.equal(detectSeatType({ boq: 'NRV', itemText: 'CHECK VALVE', spec: 'metal seated' }).seat, 'Metal seated')
  assert.equal(detectSeatType({ boq: 'NRV MS seat', itemText: 'CHECK VALVE' }).seat, 'Metal seated') // bare MS still counts in BOQ text
})

test('category seat reads only the item type and its merged details', () => {
  assert.equal(categorySeat({ itemName: 'MS valve', itemType: 'SLUICE VALVE-RESILIENT-RISING' }), 'Resilient')
  assert.equal(categorySeat({ itemName: 'resilient', itemType: 'SLUICE VALVE-METAL-RISING' }), 'Metal seated')
  assert.equal(categorySeat({ itemName: 'metal seated', itemType: 'CHECK VALVE', seatSpec: 'EPDM' }), null)
  assert.equal(categorySeat({ itemType: 'CHECK VALVE', itemNameMerge: 'metal seated' }), 'Metal seated')
})

test('seat warning: BOQ or spec names a seat the category does not', () => {
  const sl = (extra = {}) => ({ itemType: 'SLUICE VALVE-METAL-RISING', ...extra })
  assert.equal(seatMismatch(sl({ itemName: 'Resilient sluice valve' })), 'BOQ says resilient')
  assert.equal(seatMismatch(sl({ itemName: 'Sluice valve', seatSpec: 'EPDM' })), 'Spec says resilient')
  assert.equal(seatMismatch({ itemType: 'CHECK VALVE', itemName: 'NRV metal seated' }), 'BOQ says metal seated')
  assert.equal(seatMismatch({ itemType: 'CHECK VALVE', itemName: 'NRV', seatSpec: 'resilient' }), 'Spec says resilient')
  assert.equal(seatMismatch(sl({ itemName: 'MS sluice valve' })), null)
  assert.equal(seatMismatch(sl({ itemName: 'Sluice valve' })), null)
  assert.equal(seatMismatch({ itemType: 'BUTTERFLY VALVE', itemName: 'Resilient butterfly valve' }), null)
})
