import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { groupLinesByContract, pickAutoLink, planAutoLinks, type ContractLine, type DocketForMatch } from '../lib/contractDocketMatch.js'

const line = (contractNo: string, itemCode: string, orderQty: string | null): ContractLine =>
  ({ contractNo, itemCode, size: '80', orderQty, rate: '100' })
const docket = (id: string, items: [code: string, qty: number][], selectedContractNo: string[] = []): DocketForMatch => ({
  id, docketNumber: id, partyName: 'P', enquiryDate: '2026-10-01', selectedContractNo,
  items: items.map(([erpItemCode, quantity], i) => ({ id: `${id}-${i}`, erpItemCode, size: '80', quantity })),
})

// Contract C1: A x 5, B x 3.
const lines = groupLinesByContract([line('C1', 'A', '5'), line('C1', 'B', '3')])
const none = new Set<string>()

test('a unique full match links that docket', () => {
  const near = docket('d2', [['A', 5], ['B', 2]])
  const full = docket('d1', [['A', 2], ['A', 3], ['B', 3], ['X', 9]])
  assert.deepEqual(pickAutoLink('C1', [near, full], lines, none), { outcome: 'linked', docketId: 'd1' })
})

test('two full matches are ambiguous, left for the Match button', () => {
  const dockets = [docket('d1', [['A', 5], ['B', 3]]), docket('d2', [['B', 3], ['A', 5]])]
  assert.deepEqual(pickAutoLink('C1', dockets, lines, none), { outcome: 'ambiguous' })
})

test('one candidate with a qty mismatch is partial', () => {
  assert.deepEqual(pickAutoLink('C1', [docket('d1', [['A', 5], ['B', 4]])], lines, none), { outcome: 'partial' })
})

test('one candidate missing an item code is partial, and so is no candidate at all', () => {
  assert.deepEqual(pickAutoLink('C1', [docket('d1', [['A', 5]])], lines, none), { outcome: 'partial' })
  assert.deepEqual(pickAutoLink('C1', [], lines, none), { outcome: 'partial' })
})

test('a contract some docket already carries is never linked again', () => {
  const full = docket('d1', [['A', 5], ['B', 3]])
  assert.deepEqual(pickAutoLink('c1 ', [full], lines, new Set(['C1'])), { outcome: 'alreadyLinked' })
})

test('a contract line without a qty cannot be a full match', () => {
  const blankQty = groupLinesByContract([line('C2', 'A', '5'), line('C2', 'B', null)])
  assert.deepEqual(pickAutoLink('C2', [docket('d1', [['A', 5]])], blankQty, none), { outcome: 'partial' })
})

// planAutoLinks: every contract is decided against the same start-of-run state.
const plan = (contractNo: string, ...dockets: DocketForMatch[]) => ({ contractNo, dockets })
const ambiguous = { outcome: 'ambiguous' }

test('plan: a subset contract and the exact contract contest one docket -> both ambiguous, in either order', () => {
  const crLines = groupLinesByContract([line('SD-010', 'A', '5'), line('SD-011', 'A', '5'), line('SD-011', 'B', '3')])
  const d1 = docket('D1', [['A', 5], ['B', 3]])
  assert.deepEqual(planAutoLinks([plan('SD-010', d1), plan('SD-011', d1)], crLines, none), [ambiguous, ambiguous])
  assert.deepEqual(planAutoLinks([plan('SD-011', d1), plan('SD-010', d1)], crLines, none), [ambiguous, ambiguous])
})

test('plan: a docket split over two contracts links both in one run', () => {
  const crLines = groupLinesByContract([line('C67', 'X', '15'), line('C68', 'Y', '4')])
  const d312 = docket('312', [['X', 15], ['Y', 4]])
  const linked312 = { outcome: 'linked', docketId: '312' }
  assert.deepEqual(planAutoLinks([plan('C67', d312), plan('C68', d312)], crLines, none), [linked312, linked312])
})

test('plan: two identical contracts for one docket -> both ambiguous', () => {
  const crLines = groupLinesByContract([line('C1', 'A', '5'), line('C2', 'A', '5')])
  const d = docket('d1', [['A', 5]])
  assert.deepEqual(planAutoLinks([plan('C1', d), plan('C2', d)], crLines, none), [ambiguous, ambiguous])
})

test('plan: an uncontested unique match still links; other outcomes pass through', () => {
  const near = docket('d2', [['A', 5], ['B', 2]])
  const full = docket('d1', [['A', 5], ['B', 3]])
  assert.deepEqual(planAutoLinks([plan('C1', near, full), plan('C9', full)], lines, new Set(['C9'])), [
    { outcome: 'linked', docketId: 'd1' },
    { outcome: 'alreadyLinked' },
  ])
})

// Ruling 1: the nightly job writes the link only. Guards against a later "make it like the button" edit.
test('the nightly job path never touches item rates or server actions', () => {
  const APP = path.join(import.meta.dirname, '..')
  const RATE_WRITES = /enquiryItem|recalculateItem|logItemChanges|quotedRate|vaPercent|@\/app\/actions/
  for (const file of ['schedular_function/docket-auto-link.ts', 'lib/contractDocketLink.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(APP, file), 'utf8'), RATE_WRITES, file)
  }
})
