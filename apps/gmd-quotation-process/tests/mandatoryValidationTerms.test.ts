import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TERMS, isBlankTerm, missingValidationTerms, termsForParty, validationBlockedMessage } from '../lib/commercialTerms.js'
import {
  BASE_COST_FACTOR,
  computeCostLoading,
  formatLoadingPct,
  loadingPctFromMultiplier,
  parseCostPct,
  transportStateKeys,
  type CostLoadingTables,
} from '../lib/costLoading.js'
import {
  cleanPoPaymentTerms,
  findPoPaymentTermsColumn,
  pickPoPaymentTerms,
} from '../lib/contractPoPaymentTerms.js'

const LC60 = '60 days Letter of credit prior to date of supply with interest in Buyer Account'
const ADV20 = '20% advance against order & 80 % Against Proforma Invoice immediately after Inspection.'

const tables: CostLoadingTables = {
  paymentTerms: { [LC60]: '0.00%', [ADV20]: '0.00%', '60 days Open credit from date of Dispatch of material': '2.00%' },
  inspection: { 'Our Scope @ 1%': '1.00%', 'Client Scope @ 2%': '2.00%', NA: '0.00%' },
  pbg: { '5% For 24 Months from date of invoice.': '0.00%', '10% For 60 Months  from date of invoice.': '3.00%' },
  transport: { 'WEST BENGAL': { fullLoad: '1.00%', partLoad: '4.00%' }, 'FOR (Site In ODISHA)': { fullLoad: '2%', partLoad: '3%' } },
}

test('blank terms: null, empty, whitespace and "-" are blank; "NA" is a real choice', () => {
  assert.equal(isBlankTerm(null), true)
  assert.equal(isBlankTerm(undefined), true)
  assert.equal(isBlankTerm('  '), true)
  assert.equal(isBlankTerm('-'), true)
  assert.equal(isBlankTerm('NA'), false)
})

test('missingValidationTerms lists blank terms in display order', () => {
  assert.deepEqual(missingValidationTerms({ paymentTerms: null, inspection: '', pbg: '-' }), ['Payment terms', 'Inspection', 'PBG'])
  assert.deepEqual(missingValidationTerms({ paymentTerms: LC60, inspection: null, pbg: 'x' }), ['Inspection'])
  assert.deepEqual(missingValidationTerms({ paymentTerms: LC60, inspection: 'NA', pbg: 'x' }), [])
})

test('validationBlockedMessage names the docket and the blank terms', () => {
  const msg = validationBlockedMessage('GMD/2026-27/087', ['Payment terms', 'Inspection', 'PBG'])
  assert.match(msg, /Validation = Yes/)
  assert.match(msg, /Payment terms, Inspection and PBG are blank on docket GMD\/2026-27\/087/)
  assert.match(validationBlockedMessage(null, ['PBG']), /PBG is blank on this docket/)
})

test('parseCostPct matches the cost engine parsing', () => {
  assert.equal(parseCostPct('2.00%'), 0.02)
  assert.equal(parseCostPct(' 1.5 % '), 0.015)
  assert.equal(parseCostPct(''), 0)
  assert.equal(parseCostPct('n/a'), 0)
  assert.equal(parseCostPct(null), 0)
})

test('loading % is base factor compounded with the add-ons (task examples)', () => {
  assert.equal(BASE_COST_FACTOR, 1.08)
  assert.equal(loadingPctFromMultiplier(0.01), 9.08) // 60 days LC + inspection ours 1%
  assert.equal(loadingPctFromMultiplier(0.09), 17.72) // 20% advance + client inspection 2% + PBG/transport
  assert.equal(loadingPctFromMultiplier(0.04), 12.32) // blank terms, transport only
  assert.equal(formatLoadingPct(9.08), '9.08%')
})

test('computeCostLoading uses the same lookups as the cost engine', () => {
  const l = computeCostLoading({ paymentTerms: LC60, inspection: 'Our Scope @ 1%', pbg: '5% For 24 Months from date of invoice.', state: null }, 100000, tables)
  assert.equal(l.loadingPct, 9.08)

  // Blank terms load nothing but transport: the "silent default".
  const blank = computeCostLoading({ paymentTerms: null, inspection: null, pbg: null, state: 'West Bengal' }, 100000, tables)
  assert.equal(blank.paymentPct + blank.inspectionPct + blank.pbgPct, 0)
  assert.equal(blank.transportPct, 0.04)
  assert.equal(blank.loadingPct, 12.32)

  // Full load at or above 50 lakh product cost.
  assert.equal(computeCostLoading({ state: 'WEST BENGAL' }, 5_000_000, tables).transportPct, 0.01)

  // Unknown term values load 0%, like a missing lookup row.
  assert.equal(computeCostLoading({ paymentTerms: 'typo terms' }, 1, tables).paymentPct, 0)
})

test('transport state keys follow the engine order (raw, normalized, FOR (Site In ...))', () => {
  assert.deepEqual(transportStateKeys('Odisha'), ['Odisha', 'ODISHA', 'FOR (Site In ODISHA)'])
  assert.deepEqual(transportStateKeys('-'), [])
  assert.equal(computeCostLoading({ state: 'Odisha' }, 10, tables).transportPct, 0.03)
})

test('PO payment terms column is optional and matched loosely', () => {
  assert.equal(findPoPaymentTermsColumn(['ERP CONTRACT NO', 'PO NO', 'Payment Terms ', 'ATTACHTMENT']), 2)
  assert.equal(findPoPaymentTermsColumn(['ERP CONTRACT NO', 'PO NO']), -1)
})

test('PO payment terms only fill a blank Contract Review value', () => {
  assert.equal(pickPoPaymentTerms(null, '  60 days  LC '), '60 days LC')
  assert.equal(pickPoPaymentTerms('-', '60 days LC'), '60 days LC')
  assert.equal(pickPoPaymentTerms('typed by user', '60 days LC'), undefined)
  assert.equal(pickPoPaymentTerms(null, '#N/A'), undefined)
  assert.equal(pickPoPaymentTerms(null, ''), undefined)
  assert.equal(cleanPoPaymentTerms('#REF!'), null)
})

test('termsForParty falls back to defaults when there is no prior enquiry', () => {
  assert.deepEqual(termsForParty(null), DEFAULT_TERMS)
})

test('termsForParty copies a full prior enquiry', () => {
  const last = { paymentTerms: '45 days', inspection: 'Client Scope @ 0.75%', pbg: '5%' }
  assert.deepEqual(termsForParty(last), last)
})

test('termsForParty defaults only the blank fields', () => {
  assert.deepEqual(termsForParty({ paymentTerms: '45 days', inspection: '', pbg: '-' }), {
    paymentTerms: '45 days',
    inspection: DEFAULT_TERMS.inspection,
    pbg: DEFAULT_TERMS.pbg,
  })
})
