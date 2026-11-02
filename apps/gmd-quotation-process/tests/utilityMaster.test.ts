import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseCsv,
  parseUtilityMaster,
  parseUtilityMapping,
  buildUtilityResolver,
  mergeProjectReference,
  canonicalUtility,
  UTILITY_MASTER_CSV,
  UTILITY_MAPPING_CSV,
} from '@gmd/contract-review/utility-master'

const DATA = path.join(__dirname, '..', 'data')
const masterCsv = readFileSync(path.join(DATA, 'utility-master.csv'), 'utf8')
const mappingCsv = readFileSync(path.join(DATA, 'utility-old-new-mapping.csv'), 'utf8')
const lf = (s: string) => s.replace(/\r\n/g, '\n')

test('parseCsv handles quoted commas, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [{ a: 'x, y', b: 'say "hi"' }])
})

test('embedded utility data matches the committed CSVs', () => {
  assert.equal(lf(UTILITY_MASTER_CSV), lf(masterCsv))
  assert.equal(lf(UTILITY_MAPPING_CSV), lf(mappingCsv))
})

test('CSVs: 76 master rows, 67 mappings, 12 VERIFY, every target in master', () => {
  const master = parseUtilityMaster(masterCsv)
  const mapping = parseUtilityMapping(mappingCsv)
  assert.equal(master.length, 76)
  assert.equal(mapping.length, 67)
  assert.equal(mapping.filter((m) => m.verify).length, 12)
  const shorts = new Set(master.map((m) => m.shortName))
  for (const m of mapping.filter((m) => !m.verify)) assert.ok(shorts.has(m.newShortName), m.oldValue)
})

test('resolver: trim + case-insensitive, VERIFY never maps, master names recognised', () => {
  const resolve = buildUtilityResolver(
    [{ code: 'UTL-1', name: 'Steel Authority of India Limited', shortName: 'SAIL', state: 'ALL INDIA' }],
    [
      { oldValue: 'Bhilai Steel Plant', newShortName: 'SAIL', projectReference: 'Bhilai Steel Plant', verify: false },
      { oldValue: 'O&M Project', newShortName: '', projectReference: 'O&M Project', verify: true },
    ],
  )
  assert.deepEqual(resolve('  bhilai   STEEL plant '), { kind: 'map', utility: 'SAIL', projectReference: 'Bhilai Steel Plant' })
  assert.deepEqual(resolve('o&m project'), { kind: 'verify' })
  assert.deepEqual(resolve('steel authority of india limited'), { kind: 'map', utility: 'SAIL', projectReference: '' })
  assert.deepEqual(resolve('sail'), { kind: 'map', utility: 'SAIL', projectReference: '' })
  assert.deepEqual(resolve('Unknown Board'), { kind: 'unmatched' })
})

test('mergeProjectReference sets blank, appends otherwise, and is idempotent', () => {
  assert.equal(mergeProjectReference(null, 'Ujjain'), 'Ujjain')
  assert.equal(mergeProjectReference('  ', 'Ujjain'), 'Ujjain')
  assert.equal(mergeProjectReference('PO 12', 'Ujjain'), 'PO 12; Ujjain')
  assert.equal(mergeProjectReference('PO 12; ujjain', 'Ujjain'), 'PO 12; ujjain')
  assert.equal(mergeProjectReference('PO 12', ''), 'PO 12')
  assert.equal(mergeProjectReference(null, ''), null)
})

test('canonicalUtility maps old Smartsheet values, keeps VERIFY/unknown raw', () => {
  assert.equal(canonicalUtility('INDIAN RAILWAYS '), 'IR')
  assert.equal(canonicalUtility('Delhi Jal Board'), 'DJB')
  assert.equal(canonicalUtility('GUJARAT WATER SUPPLY & SEWERAGE BOARD'), 'GWSSB')
  assert.equal(canonicalUtility('Water Resources Department'), 'Water Resources Department')
  assert.equal(canonicalUtility(' Some New Utility '), 'Some New Utility')
  assert.equal(canonicalUtility(''), null)
})
