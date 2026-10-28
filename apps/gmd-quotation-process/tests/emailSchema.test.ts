import test from 'node:test'
import assert from 'node:assert/strict'
import { emailSchema } from '../lib/email.js'

test('emailSchema trims and lowercases valid emails', () => {
  assert.equal(emailSchema.parse('  A@B.COM '), 'a@b.com')
})

test('emailSchema rejects malformed, empty and overlong emails', () => {
  for (const bad of ['a@b', 'foo', '', `${'a'.repeat(250)}@b.com`]) {
    assert.equal(emailSchema.safeParse(bad).success, false, bad)
  }
})
