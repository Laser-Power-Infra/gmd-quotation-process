import test from 'node:test'
import assert from 'node:assert/strict'
import { contactFromMail, firstMessage, utilityEntries, utilityFromText } from '../lib/docketContact.js'
import { applyAiContact } from '../lib/docketContactAi.js'
import { buildEnquiryWhereSql } from '../lib/enquiry-query.js'
import { emptyEnquiryQuery, missingContactFields } from '../lib/enquiryQuery.js'

const NONE = { contactPerson: null, phone: null }
const mail = (...lines: string[]) => lines.join('\n')

test('firstMessage: the Message 1 block of the thread body, else the preview', () => {
  const body = mail('--- Message 1 From: A <a@x.com> ---', 'first', '--- Message 2 From: B <b@y.com> ---', 'second')
  assert.equal(firstMessage({ body, bodyPreview: 'preview' }), mail('--- Message 1 From: A <a@x.com> ---', 'first'))
  assert.equal(firstMessage({ body: null, bodyPreview: 'preview' }), 'preview')
})

test('signature: name and +91 mobile after the sign-off; designation, company and email lines skipped', () => {
  const message = mail(
    '--- Message 1 From: "Yash Darji ( Sr. Executive )" <procurement10@lccprojects.com> ---',
    '',
    'Dear Sir,',
    'Please find below rate inquiry of sluice valves. PR - 23006699',
    '',
    '*Thanks & Regards,*',
    '',
    '*Yash Darji*',
    'Senior Executive - Procurement',
    '*LCC Projects Limited*',
    '',
    '[telephone icon] +91 98751 55445',
    '[email icon] procurement10@lccprojects.com',
  )
  assert.deepEqual(contactFromMail({ firstMessage: message, senderEmail: 'procurement10@lccprojects.com' }), {
    contactPerson: 'Yash Darji',
    phone: '+91 98751 55445',
  })
})

test('signature: plain 10-digit mobile and a one-word name', () => {
  assert.deepEqual(contactFromMail({ firstMessage: mail('Please quote.', '', 'Regards,', 'Shivani.', '9552511045') }), {
    contactPerson: 'Shivani',
    phone: '+91 95525 11045',
  })
})

test('signature: landline with STD code kept as written; designation above the name and Mr. prefix dropped', () => {
  const message = mail('Kindly quote.', 'Best regards', 'Assistant Manager - Purchase', 'Mr. Rahul Raj', 'Ph : 033-2345 6789', 'Fax : 033-2345 6790')
  assert.deepEqual(contactFromMail({ firstMessage: message }), { contactPerson: 'Rahul Raj', phone: '033-2345 6789' })
})

test('signature: a mobile wins over an earlier landline, fax ignored', () => {
  const message = mail(
    'Thanks & Regards',
    'P. Varma Raju',
    'Assistant Manager,',
    'NCC House,',
    'Madhapur, Hyderabad - 500 081',
    'Ph : +91 40 2326 8888 (Ext.:8593)',
    'Fax : +91 40 2312 5555',
    'Mob# : +91 9154881585,',
  )
  assert.deepEqual(contactFromMail({ firstMessage: message }), { contactPerson: 'P. Varma Raju', phone: '+91 91548 81585' })
})

test('signature: "BR" sign-off', () => {
  assert.deepEqual(contactFromMail({ firstMessage: mail('Kindly provide the dispatch schedule.', '', 'BR', 'RAHUL RAJ', '', 'From: Rahul Raj') }), {
    contactPerson: 'RAHUL RAJ',
    phone: null,
  })
})

test('signature: name on the sign-off line; "For <company>" is not a name', () => {
  assert.deepEqual(
    contactFromMail({ firstMessage: mail('Thanks & Regards,Arvind Mistry', 'AA ENGINEERS', 'Mobile :- 9925150984/8511939490') }),
    { contactPerson: 'Arvind Mistry', phone: '+91 99251 50984' },
  )
  assert.deepEqual(
    contactFromMail({ firstMessage: mail('Thanks & Regards', 'For  FLOWMORE LIMITED', 'Shaffali Gupta', 'Sr. Manager - Projects') }),
    { contactPerson: 'Shaffali Gupta', phone: null },
  )
})

test('no sign-off: nulls, even with a phone in the body', () => {
  assert.deepEqual(contactFromMail({ firstMessage: mail('Dear Sir,', 'Please quote 10 nos 100 mm sluice valves.', 'Call me on 9830012345.') }), NONE)
})

test('a phone in the body above the signature is ignored', () => {
  const message = mail('For technical queries contact Mr. Rahul Prajapati (+91 99988 02268).', '', 'Thanks & Regards,', 'Yash Darji', 'LCC Projects Limited')
  assert.deepEqual(contactFromMail({ firstMessage: message }), { contactPerson: 'Yash Darji', phone: null })
})

test('the quoted mail below the author is not their signature', () => {
  const message = mail('Regards', 'Sumeet Bisht', 'From: G.M.Dalui & Sons Pvt. Ltd. <info@gmdalui.co.in>', 'Sent: 18 November 2025 18:30', 'Regards,', 'Tridip', '9147176248')
  assert.deepEqual(contactFromMail({ firstMessage: message }), { contactPerson: 'Sumeet Bisht', phone: null })
})

test('our own forward: only the forwarded original from the docket sender counts', () => {
  const message = mail(
    '--- Message 1 From: Puja Agarwal <puja.agarwal@laserpowerinfra.com> ---',
    'Dear Team, please create the docket.',
    'Warm regards,',
    'Puja Agarwal',
    '+91 88200 44755',
    '---------- Forwarded message ---------',
    'From: Yash Darji <procurement10@lccprojects.com>',
    'Subject: Rate Inquiry',
    '',
    'Dear Sir, please quote.',
    'Thanks & Regards,',
    'Yash Darji',
    '+91 98751 55445',
  )
  assert.deepEqual(contactFromMail({ firstMessage: message, senderEmail: 'procurement10@lccprojects.com' }), {
    contactPerson: 'Yash Darji',
    phone: '+91 98751 55445',
  })
  assert.deepEqual(contactFromMail({ firstMessage: message, senderEmail: 'buyer@other.com' }), NONE)
})

// Active UTILITY LookupOption rows (the seeded master), as docket creation loads them.
const entries = utilityEntries([
  { value: 'PHED RJ', code: 'UTL-WTR-RJ-001' },
  { value: 'SAIL', code: 'UTL-STL-IN-001' },
  { value: 'KWA', code: 'UTL-WTR-KL-001' },
  { value: 'MPJNM', code: 'UTL-WTR-MP-002' },
  { value: 'PRIVATE', code: 'UTL-PVT-NA-001' },
])

test('utilityFromText: master full name, alias and short name give the LookupOption value', () => {
  assert.equal(utilityFromText('Valves for Public Health Engineering Department, Rajasthan - Jhalawar', entries), 'PHED RJ')
  assert.equal(utilityFromText('Delivery at Bhilai Steel Plant stores', entries), 'SAIL')
  assert.equal(utilityFromText('as per MPJNM specification', entries), 'MPJNM')
  // Case, spacing and line breaks do not matter; full and short name of one utility is not ambiguous.
  assert.equal(utilityFromText('MADHYA PRADESH  JAL NIGAM\nMARYADIT (MPJNM)', entries), 'MPJNM')
})

test('utilityFromText: two utilities, names under 4 chars, partial words and the PRIVATE marker give null', () => {
  assert.equal(utilityFromText('Kerala Water Authority and Bhilai Steel Plant', entries), null)
  assert.equal(utilityFromText('KWA project', entries), null)
  assert.equal(utilityFromText('sailing', entries), null)
  assert.equal(utilityFromText('Amrutha Constructions Private Limited', entries), null)
})

test('AI answer: phone re-parsed, utility only from the master, contact person never filled', () => {
  const blank = { contactPerson: null, phone: null, utility: null }
  // The 562 case: the AI named the company ("H C Jain") as the person.
  const answer = { contactPerson: 'H C Jain', phone: 'M: +91 9999 191 222', utility: 'kerala water  authority' }
  assert.deepEqual(applyAiContact(blank, answer, entries), { contactPerson: null, phone: '+91 99991 91222', utility: 'KWA' })
  assert.deepEqual(applyAiContact(blank, { phone: 'n/a', utility: 'LCC Projects' }, entries), blank)
  const found = { contactPerson: 'Yash Darji', phone: '+91 98751 55445', utility: 'SAIL' }
  assert.deepEqual(applyAiContact(found, { phone: '9830012345', utility: 'KWA' }, entries), found)
})

test('contact-missing toggle: offer not gone out (closure blank or Pending) and a blank contact field; no item requirement', () => {
  const where = buildEnquiryWhereSql({ ...emptyEnquiryQuery(), contactMissingOnly: true })
  for (const column of ['contactPerson', 'senderEmail', 'contactNo', 'utility']) {
    assert.match(where.sql, new RegExp(`e\\."${column}" IS NULL`), column)
  }
  assert.match(where.sql, /e\."closureStatus" IS NULL/)
  assert.doesNotMatch(where.sql, /"closureStatus"\) = '-'/)
  assert.ok(where.values.includes('pending'))
  assert.doesNotMatch(where.sql, /EXISTS \(SELECT 1 FROM "EnquiryItem"/)
})

test('missingContactFields: blank fields only while the offer has not gone out', () => {
  const docket = { contactPerson: null, senderEmail: ' ', contactNo: '-', utility: 'KWA' }
  for (const closureStatus of [null, '', 'Pending', ' PENDING ']) {
    assert.deepEqual(missingContactFields({ ...docket, closureStatus }), ['Contact person', 'Email', 'Phone'], String(closureStatus))
  }
  for (const closureStatus of ['Sent', 'Not Sent', ' - ', 'Rejected', 'Regretted']) {
    assert.deepEqual(missingContactFields({ ...docket, closureStatus }), [], closureStatus)
  }
  const complete = { contactPerson: 'Yash Darji', senderEmail: 'a@b.com', contactNo: '+91 98751 55445', utility: 'KWA' }
  assert.deepEqual(missingContactFields({ ...complete, closureStatus: 'Pending' }), [])
})
