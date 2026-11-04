import test from 'node:test'
import assert from 'node:assert/strict'
import reducer, { hydrateEnquiryPage, loadEnquiryItems } from '../lib/enquiriesSlice.js'

const item = (id: string, position: number, extra = {}) => ({ id, enquiryId: 'e1', position, ...extra }) as any
const page = (items: any[], itemsLoaded = false) => ({
  enquiries: [{ id: 'e1', items, itemsLoaded, itemCount: 3 }] as any,
  total: 1, summary: null, key: 'k',
})

test('refreshed page keeps loaded items but marks them stale; reload restores the flag', () => {
  let s = reducer(undefined, { type: 'init' })
  s = reducer(s, hydrateEnquiryPage(page([item('a', 0), item('b', 1), item('c', 2)], true)))
  assert.equal(s.enquiries.entities.e1!.itemsLoaded, true)
  s = reducer(s, hydrateEnquiryPage(page([item('a', 0, { cost: 5 })])))
  const e = s.enquiries.entities.e1!
  assert.equal(e.itemsLoaded, false)
  assert.deepEqual(e.items.map((i) => i.id), ['a', 'b', 'c'])
  assert.equal((e.items[0] as any).cost, 5)
  const full = [item('a', 0), item('cf', 1), item('b', 2)]
  s = reducer(s, { type: loadEnquiryItems.fulfilled.type, payload: full, meta: { arg: { enquiryIds: ['e1'] } } })
  assert.deepEqual(s.enquiries.entities.e1!.items.map((i) => i.id), ['a', 'cf', 'b'])
  assert.equal(s.enquiries.entities.e1!.itemsLoaded, true)
})

test('refreshed page that carries every item replaces a longer loaded list (deleted CF child)', () => {
  let s = reducer(undefined, { type: 'init' })
  s = reducer(s, hydrateEnquiryPage(page([item('a', 0), item('cf', 1)], true)))
  s = reducer(s, hydrateEnquiryPage({ enquiries: [{ id: 'e1', items: [item('a', 0)], itemsLoaded: false, itemCount: 1 }] as any, total: 1, summary: null, key: 'k' }))
  assert.deepEqual(s.enquiries.entities.e1!.items.map((i) => i.id), ['a'])
})
