import test from 'node:test'
import assert from 'node:assert/strict'
import { SPECIAL_OEM } from '../lib/actuatorCost.js'
import { buildRfq, gmailComposeUrl, isOemRfq } from '../lib/actuatorRfq.js'

// BFV|1300|PN16 is "Special – refer OEM" in MAPPING: no auto cost, the OEM must quote.
const SEL = {
  status: 'OEM RFQ', mapKey: 'BFV|1300|PN16', valveType: 'BFV', dn: 1300, pn: 'PN16', qty: 1, requiredTorque: 85030, actNeed: null,
  topFlange: 'F35', act: null, gb: null, adaptor: null, assembly: null, aumaRequired: false, flags: [] as string[],
}
const ITEM = {
  itemType: 'BUTTERFLY VALVE', itemName: 'BFV DN1300', size: '1300', pnRating: 'PN-16', quantity: 1,
  controlType: 'Modulating', operationType: 'ACT', actuatorBreakdown: { selection: SEL },
}
const lines = (body: string) => body.split('\n')

test('OEM RFQ item: new selection status, or the older Special – refer OEM pending marker', () => {
  assert.equal(isOemRfq({ actuatorBreakdown: { selection: SEL } }), true)
  assert.equal(isOemRfq({ actuatorBreakdown: { pending: [SPECIAL_OEM], text: 'Price pending: Special – refer OEM' } }), true)
  assert.equal(isOemRfq({ actuatorBreakdown: { selection: { ...SEL, status: 'OK' }, pending: [] } }), false)
  assert.equal(isOemRfq({ actuatorBreakdown: { pending: ['actuator code'] } }), false)
  assert.equal(isOemRfq({ actuatorBreakdown: null }), false)
})

test('RFQ goes to Rotork (Mrinal Ghosh) by default, cc GMD info', () => {
  const r = buildRfq(ITEM)
  assert.equal(r.to, 'Mrinal.Ghosh@rotork.com')
  assert.equal(r.cc, 'info@gmdalui.co.in')
  assert.equal(lines(r.body)[0], 'Dear Mrinal Ghosh,')
})

test('RFQ goes to AUMA (Subrata Karmakar) only when the spec asks for AUMA, same cc', () => {
  const r = buildRfq({ ...ITEM, actuatorBreakdown: { selection: { ...SEL, aumaRequired: true } } })
  assert.equal(r.to, 'Subrata.Karmakar@auma.co.in')
  assert.equal(r.cc, 'info@gmdalui.co.in')
  assert.equal(lines(r.body)[0], 'Dear Subrata Karmakar,')
})

test('subject and body carry quantity, valve, DN, PN, torque, flange and control type', () => {
  const r = buildRfq(ITEM)
  assert.equal(r.subject, 'RFQ – Electric actuator for BFV DN1300 PN16 (qty 1)')
  for (const l of ['Valve type: BFV', 'Size: DN1300', 'Pressure rating: PN16', 'Quantity: 1', 'Required torque: 85,030 Nm', 'Valve top / base flange: F35', 'Control type: Modulating'])
    assert.ok(lines(r.body).includes(l), l)
  for (const ask of [/price/i, /delivery/i, /datasheet/i]) assert.match(r.body, ask)
})

test('no customer, project, docket, location or contact detail reaches the OEM', () => {
  const secrets = {
    partyName: 'ACME Water Board', projectReference: 'Howrah WTP Phase 2', contactPerson: 'R. Sen', emailAddress: 'r.sen@acme.example',
    contactNo: '98300 12345', state: 'West Bengal', docketNumber: 'GMD-DK-0042',
  }
  const leaky = {
    ...ITEM, ...secrets, enquiry: secrets, itemName: 'BFV DN1300 for ACME Water Board, Howrah WTP Phase 2',
    actuatorBreakdown: { text: 'ACME Water Board', selection: { ...SEL, client: 'ACME Water Board', flags: ['rate increase – negotiate'] } },
  }
  const r = buildRfq(leaky)
  const out = JSON.stringify(r) + decodeURIComponent(gmailComposeUrl(r))
  for (const v of [...Object.values(secrets), 'ACME', 'Howrah', 'negotiate']) assert.ok(!out.includes(v), `leaked: ${v}`)
})

test('Gmail compose URL: view=cm, every field URL-encoded and round-trips', () => {
  const r = { to: 'a@b.com', cc: 'c@d.com', subject: 'RFQ – A & B + C #1', body: 'Line 1\nQty: 2 = 50%?' }
  const url = gmailComposeUrl(r)
  assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.com&cc=c%40d.com&su='), url)
  assert.ok(url.includes('&su=RFQ%20%E2%80%93%20A%20%26%20B%20%2B%20C%20%231&'), url)
  assert.ok(url.endsWith('&body=Line%201%0AQty%3A%202%20%3D%2050%25%3F'), url)
  const q = new URL(url).searchParams
  assert.deepEqual([q.get('to'), q.get('cc'), q.get('su'), q.get('body')], [r.to, r.cc, r.subject, r.body])
})

test('no selection yet: valve read from the item fields, torque / flange / control type left to confirm', () => {
  const r = buildRfq({ itemType: 'BUTTERFLY VALVE', size: '1300', pnRating: 'PN-16', quantity: 2, controlType: null, actuatorBreakdown: { pending: [SPECIAL_OEM] } })
  assert.equal(r.to, 'Mrinal.Ghosh@rotork.com')
  assert.equal(r.subject, 'RFQ – Electric actuator for BFV DN1300 PN16 (qty 2)')
  for (const l of ['Size: DN1300', 'Pressure rating: PN16', 'Quantity: 2', 'Required torque: to confirm', 'Valve top / base flange: to confirm', 'Control type: to confirm'])
    assert.ok(lines(r.body).includes(l), l)
})
