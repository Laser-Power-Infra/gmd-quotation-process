import test from 'node:test'
import assert from 'node:assert/strict'
import { reverseAuctionPrefix, buildDocketEmailSubject } from '../lib/docketEmailTemplate.js'

test('reverseAuctionPrefix repeats Reverse once per round', () => {
  assert.equal(reverseAuctionPrefix(0), '')
  assert.equal(reverseAuctionPrefix(1), 'Reverse Auction ')
  assert.equal(reverseAuctionPrefix(3), 'Reverse Reverse Reverse Auction ')
})

test('email subject carries the RA prefix', () => {
  assert.equal(buildDocketEmailSubject({ docketNumber: 'D1', raRound: 2 }), 'Reverse Reverse Auction Offer - D1')
  assert.equal(buildDocketEmailSubject({ docketNumber: 'D1', revised: true }), 'Revised Offer - D1')
})
