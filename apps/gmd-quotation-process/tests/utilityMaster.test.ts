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
  lookupUtilityResolver,
  standardUtility,
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

test('CSVs: 76 master rows, 67 mappings, 12 VERIFY, every target in master by code and short name', () => {
  const master = parseUtilityMaster(masterCsv)
  const mapping = parseUtilityMapping(mappingCsv)
  assert.equal(master.length, 76)
  assert.equal(mapping.length, 67)
  assert.equal(mapping.filter((m) => m.verify).length, 12)
  const shortByCode = new Map(master.map((m) => [m.code, m.shortName]))
  for (const m of mapping.filter((m) => !m.verify)) assert.equal(shortByCode.get(m.newCode), m.newShortName, m.oldValue)
})

test('resolver: trim + case-insensitive, VERIFY never maps, master names recognised', () => {
  const resolve = buildUtilityResolver(
    [{ code: 'UTL-1', name: 'Steel Authority of India Limited', shortName: 'SAIL', state: 'ALL INDIA' }],
    [
      { oldValue: 'Bhilai Steel Plant', newCode: 'UTL-1', newShortName: 'SAIL', projectReference: 'Bhilai Steel Plant', verify: false },
      { oldValue: 'O&M Project', newCode: '', newShortName: '', projectReference: 'O&M Project', verify: true },
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

// Active UTILITY LookupOption rows, as the server loader passes them in.
const lookupRows = [
  { value: 'IR', code: 'UTL-RLY-IN-001' },
  { value: 'SAIL', code: 'UTL-STL-IN-001' },
  { value: 'GWSSB', code: 'UTL-WTR-GJ-004' },
  { value: 'KWA', code: 'UTL-WTR-KL-001' },
  { value: 'Custom Board', code: null },
  // Added by an admin; the mapping sheet lists the same text as VERIFY.
  { value: 'Ujjain Project', code: null },
]

test('lookup resolver: LookupOption values are the targets, master full names and the mapping sheet are aliases', () => {
  const resolve = lookupUtilityResolver(lookupRows)
  assert.deepEqual(resolve(' custom  BOARD '), { kind: 'map', utility: 'Custom Board', projectReference: '' })
  // Master full names, found through the LookupOption code.
  assert.deepEqual(resolve('Kerala Water Authority'), { kind: 'map', utility: 'KWA', projectReference: '' })
  assert.deepEqual(resolve('GUJARAT WATER SUPPLY & SEWERAGE BOARD'), { kind: 'map', utility: 'GWSSB', projectReference: '' })
  // Mapping sheet aliases, with their project reference.
  assert.deepEqual(resolve('INDIAN RAILWAYS '), { kind: 'map', utility: 'IR', projectReference: '' })
  assert.deepEqual(resolve('Bhilai Steel Plant'), { kind: 'map', utility: 'SAIL', projectReference: 'Bhilai Steel Plant' })
  assert.deepEqual(resolve('Water Resources Department'), { kind: 'verify' })
  // The alias target AMC is not a LookupOption value here, so the old text is not mapped.
  assert.deepEqual(resolve('Amdavad Municipal Corporation'), { kind: 'unmatched' })
  // A LookupOption value always resolves to itself, even when the mapping sheet lists it.
  assert.deepEqual(resolve('ujjain project'), { kind: 'map', utility: 'Ujjain Project', projectReference: '' })
})

test('lookup resolver: a mapping alias follows its utility code when the LookupOption value is renamed', () => {
  const resolve = lookupUtilityResolver([
    // SAIL renamed on /admin/lookup-options; the code stays.
    { value: 'Steel Authority of India', code: 'UTL-STL-IN-001' },
    // A row without a code: the alias falls back to the mapping sheet's short name.
    { value: 'AMC', code: null },
  ])
  assert.deepEqual(resolve('Bhilai Steel Plant'), {
    kind: 'map',
    utility: 'Steel Authority of India',
    projectReference: 'Bhilai Steel Plant',
  })
  assert.deepEqual(resolve('Amdavad Municipal Corporation'), { kind: 'map', utility: 'AMC', projectReference: '' })
})

test('standardUtility: blank is null, a match is the LookupOption value, other text is kept as typed and counted', () => {
  const resolve = lookupUtilityResolver(lookupRows)
  const unknown = new Map<string, number>()
  assert.equal(standardUtility(resolve, null, unknown), null)
  assert.equal(standardUtility(resolve, '   ', unknown), null)
  // The sheets' dash placeholders are blank too: never written, never reported.
  assert.equal(standardUtility(resolve, ' - ', unknown), null)
  assert.equal(standardUtility(resolve, '—', unknown), null)
  assert.equal(standardUtility(resolve, ' indian railways ', unknown), 'IR')
  assert.equal(standardUtility(resolve, ' Some New Board ', unknown), 'Some New Board')
  assert.equal(standardUtility(resolve, 'Some New Board', unknown), 'Some New Board')
  assert.equal(standardUtility(resolve, 'Water Resources Department', unknown), 'Water Resources Department')
  assert.deepEqual(Object.fromEntries(unknown), { 'Some New Board': 2, 'Water Resources Department': 1 })
})

test('server: dropdown options and resolver read only the active UTILITY LookupOption rows', async () => {
  const at = new Date('2026-11-01T00:00:00Z')
  const rows = [
    { id: 'a', type: 'UTILITY', value: 'SAIL', sortOrder: 7, isActive: true, code: 'UTL-STL-IN-001', defaultState: 'ALL INDIA', createdAt: at, updatedAt: at },
    { id: 'b', type: 'UTILITY', value: 'Old Board', sortOrder: 0, isActive: false, code: null, defaultState: null, createdAt: at, updatedAt: at },
    { id: 'c', type: 'STATE', value: 'GUJARAT', sortOrder: 0, isActive: true, code: null, defaultState: null, createdAt: at, updatedAt: at },
    { id: 'd', type: 'UTILITY', value: 'DJB', sortOrder: 19, isActive: true, code: 'UTL-WTR-DL-001', defaultState: 'DELHI', createdAt: at, updatedAt: at },
  ]
  // @gmd/db-quotation reuses globalThis.quotationPrisma when set. The fake applies
  // the equality filters in `where` the way Postgres would, and keeps table order.
  ;(globalThis as unknown as { quotationPrisma: unknown }).quotationPrisma = {
    lookupOption: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)),
    },
  }
  const { getUtilityOptions, loadUtilityResolver } = await import('@gmd/contract-review/server/utility')

  assert.deepEqual(await getUtilityOptions(), ['DJB', 'SAIL'])
  const resolve = await loadUtilityResolver()
  assert.deepEqual(resolve('Delhi Jal Board'), { kind: 'map', utility: 'DJB', projectReference: '' })
  assert.deepEqual(resolve('Old Board'), { kind: 'unmatched' })
  assert.deepEqual(resolve('GUJARAT'), { kind: 'unmatched' })

  // A wrong or unseeded DB (no active UTILITY rows) fails the run instead of writing raw text.
  rows.length = 0
  await assert.rejects(loadUtilityResolver(), /no active UTILITY/i)
})
