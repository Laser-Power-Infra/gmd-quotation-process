import test from 'node:test'
import assert from 'node:assert/strict'
import { pickLatestQuotes, quoteKey } from '../lib/quotedCost.js'

const OLD = new Date('2026-01-01T00:00:00Z')
const NEW = new Date('2026-06-01T00:00:00Z')
const enquiry = (selectedContractNo: string[], at: Date, docketNumber = 'GMD/2026-27/001') => ({ selectedContractNo, enquiryDate: at, createdAt: at, docketNumber })

test('quoted cost: the latest enquiry wins, for every contract it selected', () => {
  const map = pickLatestQuotes([
    { erpItemCode: 'fsd040001 ', cost: 900, quotedRate: null, enquiry: enquiry(['c-1'], OLD) },
    { erpItemCode: 'FSD040001', cost: 1000, quotedRate: null, enquiry: enquiry(['C-1', 'C-2'], NEW) },
    { erpItemCode: 'FSD040001', cost: 800, quotedRate: null, enquiry: enquiry(['C-1'], OLD) }, // older, even though read later
    { erpItemCode: 'FSD040001', cost: null, quotedRate: null, enquiry: enquiry(['C-3'], OLD) },
    { erpItemCode: null, cost: 1, quotedRate: null, enquiry: enquiry(['C-1'], NEW) },
    { erpItemCode: 'FSD040001', cost: 1, quotedRate: null, enquiry: null },
  ])
  assert.equal(map.get(quoteKey('C-1', 'FSD040001'))?.cost, '1000')
  assert.equal(map.get(quoteKey('C-1', 'FSD040001'))?.recency, NEW.getTime())
  assert.equal(map.get(quoteKey(' c-2', 'fsd040001'))?.cost, '1000')
  assert.equal(map.get(quoteKey('C-3', 'FSD040001'))?.cost, null)
  assert.equal(map.get(quoteKey('C-3', 'FSD040001'))?.recency, OLD.getTime())
  assert.equal(map.size, 3)
})

test('quoted cost: the winning enquiry also gives its docket no and quoted rate', () => {
  const map = pickLatestQuotes([
    { erpItemCode: 'FSD040001', cost: 800, quotedRate: '950.00', enquiry: enquiry(['C-1'], OLD, 'GMD/2026-27/001') },
    { erpItemCode: 'FSD040001', cost: 900, quotedRate: '1100.00', enquiry: enquiry(['C-1'], NEW, 'GMD/2026-27/002') },
    { erpItemCode: 'FSD040001', cost: 700, quotedRate: null, enquiry: enquiry(['C-2'], NEW, 'GMD/2026-27/003') },
  ])
  assert.deepEqual(map.get(quoteKey('C-1', 'FSD040001')), {
    cost: '900',
    docketNo: 'GMD/2026-27/002',
    quotedRate: '1100.00',
    recency: NEW.getTime(),
  })
  // A docket with no quoted rate still links back; the rate stays blank.
  assert.deepEqual(map.get(quoteKey('C-2', 'FSD040001')), {
    cost: '700',
    docketNo: 'GMD/2026-27/003',
    quotedRate: null,
    recency: NEW.getTime(),
  })
})
