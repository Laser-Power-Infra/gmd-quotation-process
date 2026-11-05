import test from 'node:test'
import assert from 'node:assert/strict'
import { pickBomComponentCode } from '../lib/verifyBomLookup.js'

const rm = (code: string) => ({ rawMaterial: { erpItemCode: code }, fullItem: null })
const fi = (code: string) => ({ rawMaterial: null, fullItem: { itemCode: code } })

test('pickBomComponentCode: raw material wins, item component is the fallback, self is skipped', () => {
  assert.equal(pickBomComponentCode('FBC010533', [fi('FBD010509'), rm('RSD110023')]), 'RSD110023')
  assert.equal(pickBomComponentCode('FBC010533', [fi('FBD010509')]), 'FBD010509')
  assert.equal(pickBomComponentCode('FSC030428', [fi('FSC030428')]), null)
  assert.equal(pickBomComponentCode('FSC030428', [fi('FSC030428'), fi('FSC030500')]), 'FSC030500')
  assert.equal(pickBomComponentCode('X', []), null)
})
