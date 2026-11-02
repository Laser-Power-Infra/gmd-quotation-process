import test from 'node:test'
import assert from 'node:assert/strict'
import {
  invoiceNumbersForRow,
  type InvoiceLookup,
} from '../lib/pbg/reminder-invoices.js'

function lookup(): InvoiceLookup {
  return {
    byBg: new Map([
      ['BG1', ['GD24Y-002', 'GD24Y-001']],
    ]),
    byPo: new Map([
      ['PO1', ['GD24Y-009']],
    ]),
  }
}

test('exact BG match wins over PO fallback', () => {
  assert.deepEqual(
    invoiceNumbersForRow({ bgNo: 'bg1', poNumber: 'PO1' }, lookup()),
    ['GD24Y-002', 'GD24Y-001'],
  )
})

test('falls back to the PO when the BG has no exact match', () => {
  assert.deepEqual(
    invoiceNumbersForRow({ bgNo: 'BG2', poNumber: 'po1' }, lookup()),
    ['GD24Y-009'],
  )
})

test('returns an empty list when neither BG nor PO matches', () => {
  assert.deepEqual(
    invoiceNumbersForRow({ bgNo: 'BG2', poNumber: 'PO2' }, lookup()),
    [],
  )
})

test('treats placeholder BG keys as blank and falls back to PO', () => {
  assert.deepEqual(
    invoiceNumbersForRow({ bgNo: '0', poNumber: 'PO1' }, lookup()),
    ['GD24Y-009'],
  )
})
