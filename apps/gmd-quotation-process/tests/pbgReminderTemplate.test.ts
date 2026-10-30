import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReminderEmail } from '../lib/pbg/reminder-template.js'

const rows = [
  {
    bgNo: '1196IBG133509',
    bgDate: '2023-03-27',
    bgAmtFc: 108939,
    expiryDate: '2026-11-27',
    poNumber: '3000179463',
    project: 'MASORA SINDWAHA WATER SUPPLY',
    clientName: 'Kalpataru Projects International Ltd',
    invoiceNos: ['GD24Y-001', 'GD24Y-002'],
  },
  {
    bgNo: '1196IBG133511',
    bgDate: '2023-03-27',
    bgAmtFc: 192595,
    expiryDate: '2026-11-27',
    poNumber: '3000179463',
    project: 'MASORA SINDWAHA WATER SUPPLY',
    clientName: 'Kalpataru Projects International Ltd',
    invoiceNos: ['GD24Y-003'],
  },
  {
    bgNo: '1196IBG133512',
    bgDate: '2023-03-27',
    bgAmtFc: 5000,
    expiryDate: '2026-12-15',
    poNumber: '3000179464',
    project: 'SECOND PROJECT',
    clientName: 'Kalpataru Projects International Ltd',
    invoiceNos: [],
  },
]

const firstTwo = rows.filter((row) => row.expiryDate === '2026-11-27')

test('pre-expiry mail uses the new 30-day body and shared expiry date', () => {
  const email = buildReminderEmail({
    stage: 'BEFORE_30_DAYS',
    rows: firstTwo,
    partyName: 'Kalpataru Projects International Ltd',
  })

  assert.match(email.subject, /PBGs expiring within 30 days/)
  assert.match(email.subject, /Kalpataru Projects International Ltd/)
  assert.match(email.html, /bring to your kind notice/)
  assert.match(email.html, /going to expire on 27 Nov 2026/)
  assert.match(email.html, /please inform us before 27 Nov 2026/)
  assert.match(email.html, /above order is going to expire/)
  assert.match(email.html, /above Performance Bank Guarantees/)
  assert.match(email.html, /Kindly acknowledge receipt of this letter/)
  assert.match(email.html, /Ms\. Puja Agarwal/)
  assert.match(email.html, /Director/)
  assert.doesNotMatch(email.html, /courier details/i)
  assert.match(email.html, /Invoice No/)
  assert.match(email.html, /GD24Y-001, GD24Y-002/)
  assert.match(email.html, /PO Total/)
  assert.match(email.html, /3,01,534\.00/)
})

test('pre-expiry mail uses the table dates and plural orders when dates differ', () => {
  const email = buildReminderEmail({
    stage: 'BEFORE_30_DAYS',
    rows,
    partyName: 'Kalpataru Projects International Ltd',
  })

  assert.match(email.html, /above orders are going to expire/)
  assert.match(
    email.html,
    /on the respective dates shown in the table above/,
  )
  assert.match(
    email.html,
    /before the respective dates shown in the table above/,
  )
  assert.match(email.html, /After the above dates/)
})

test('expiry-day mail keeps the confirmation body and today date', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: firstTwo,
    onExpiryDate: true,
    partyName: 'Kalpataru Projects International Ltd',
  })

  assert.match(email.subject, /PBG expiring today/)
  assert.match(email.html, /expired today, 27 Nov 2026/)
  assert.match(email.html, /performance period against the supplied material is complete/)
  assert.match(email.html, /The said bank guarantees are considered as closed/)
  assert.match(email.html, /Ms\. Puja Agarwal/)
  assert.doesNotMatch(email.html, /courier details/i)
})

test('interval mail uses reminder number, earlier dates, Udyam and provisions', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows,
    onExpiryDate: false,
    partyName: 'Kalpataru Projects International Ltd',
    reminderNumber: 1,
    earlierMailDates: ['2026-10-26'],
    udyamNo: 'UDYAM-TEST-123',
  })

  assert.match(email.subject, /Expired PBG return request/)
  assert.match(email.html, /This is reminder no\. 1 with reference to our letters dated 26 Oct 2026/)
  assert.match(
    email.html,
    /Performance Bank Guarantees expired on the respective dates shown in the table above/,
  )
  assert.match(
    email.html,
    /As we are a registered MSME \(Udyam Registration No\. UDYAM-TEST-123\) following are the Applicable provisions:/,
  )
  assert.match(email.html, /Rule 171 of the General Financial Rules/)
  assert.match(email.html, /Sections 15 &amp; 16 – amounts/)
  assert.match(email.html, /Section 18 of the MSMED Act/)
  assert.match(email.html, /issuing bank within 7 days/)
  assert.match(email.html, /original BGs \/ discharge letters/)
  assert.doesNotMatch(email.html, /bank limits blocked/)
  assert.match(email.html, /Ms\. Puja Agarwal/)
  assert.doesNotMatch(email.html, /courier details/i)
})

test('interval mail uses the shared expiry date and falls back when no earlier dates exist', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: firstTwo,
    onExpiryDate: false,
    partyName: 'Kalpataru Projects International Ltd',
    reminderNumber: 2,
  })

  assert.match(email.html, /This is reminder no\. 2 with reference to our earlier letters/)
  assert.match(email.html, /Performance Bank Guarantees expired on 27 Nov 2026/)
  assert.match(
    email.html,
    /Udyam Registration No\. \[UDYAM-XX-00-0000000\]/,
  )
})

test('single interval BG uses singular wording', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [rows[0]],
    onExpiryDate: false,
    reminderNumber: 1,
  })

  assert.match(email.html, /Performance Bank Guarantee expired on 27 Nov 2026/)
  assert.match(email.html, /original BG \/ discharge letter has not been received/)
})

test('html escapes untrusted values', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [
      {
        ...rows[0],
        project: '<script>alert(1)</script>',
        poNumber: 'A & B',
      },
    ],
    onExpiryDate: false,
  })

  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
  assert.match(email.html, /A &amp; B/)
})

test('text body contains PO-wise sections, invoice numbers and numbered provisions', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows,
    onExpiryDate: false,
    reminderNumber: 1,
    earlierMailDates: ['2026-10-26'],
  })

  assert.match(email.text, /PO No: 3000179463/)
  assert.match(email.text, /PO No: 3000179464/)
  assert.match(email.text, /PO Total: 3,01,534\.00/)
  assert.match(email.text, /Grand Total: 3,06,534\.00/)
  assert.match(email.text, /Invoice No: GD24Y-001, GD24Y-002/)
  assert.match(email.text, /Applicable provisions:/)
  assert.match(email.text, /1\. Rule 171/)
  assert.match(email.text, /2\. Micro, Small and Medium Enterprises/)
  assert.match(email.text, /3\. Section 18/)
  assert.match(email.text, /Thanks & Regards,/)
  assert.match(email.text, /Ms\. Puja Agarwal/)
})
