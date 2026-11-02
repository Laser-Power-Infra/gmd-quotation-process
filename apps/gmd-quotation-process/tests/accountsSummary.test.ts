import test from 'node:test'
import assert from 'node:assert/strict'
import { summarise } from '../lib/debtorsAgeing.js'
import { buildOsSummary } from '../lib/accountsSummary.js'

test('O/S message totals debtors and nets creditor credits', () => {
  const today = new Date('2026-11-02')
  const deb = summarise([{ accCode: 'A', accName: 'A', dueDate: '2026-09-01', vrDate: null, unAllocDr: 500000, unAllocCr: 0 }], today)
  const cred = summarise([{ accCode: 'B', accName: 'B', dueDate: '2026-12-01', vrDate: null, unAllocDr: 0, unAllocCr: 200000 }], today, { side: 'creditor' })
  const { data, text } = buildOsSummary(deb, cred, today, null)
  assert.equal(data.debtors.total, 500000)
  assert.equal(data.creditors.net, 200000)
  assert.match(text, /Debtors: ₹5.00 L/)
})
