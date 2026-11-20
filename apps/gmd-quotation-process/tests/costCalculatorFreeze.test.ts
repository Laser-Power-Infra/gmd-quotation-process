import test from 'node:test'
import assert from 'node:assert/strict'
import { isRecalcBlocked, FROZEN_ITEM_FIELD_SET } from '../lib/oneClickAccess.js'

test('frozen docket: recalculateItem keeps prices unless the caller allows it', () => {
  const pdfAt = new Date()
  assert.equal(isRecalcBlocked('Yes', pdfAt), true) // frozen, no flag: no recalculation
  assert.equal(isRecalcBlocked('Yes', pdfAt, true), false) // contract-match / scripts pass allowFrozen
  assert.equal(isRecalcBlocked('Yes', null), false) // offer PDF not generated yet
  assert.equal(isRecalcBlocked(null, pdfAt), false) // APM blank: never frozen
  // Extension / Bypass add flat costs, so a frozen docket refuses them like the other price inputs.
  assert.ok(FROZEN_ITEM_FIELD_SET.has('extension') && FROZEN_ITEM_FIELD_SET.has('bypass'))
})
