import test from 'node:test'
import assert from 'node:assert/strict'
import { drawingsByCode } from '../lib/gmd_lib/rmDrawings.js'

const HEADERS = ['RM CODE', 'COMPONENT', 'VALVE SIZE (mm)', 'DRAWING LINK', 'ALTERNATE DRAWING', 'STATUS']
const TAIL = 'https://drive.google.com/file/d/TAIL/view'
const DRIVE = 'https://drive.google.com/file/d/DRIVE/view'
const SEAL = 'https://drive.google.com/file/d/SEAL/view'

const tab = (rows: string[][], headers = HEADERS) => ({ tabTitle: 'RM drawing map (Asmita)', headers, rows })
const row = (code: string, link: string, alt = '') => [code, 'PART', '900', link, alt, '']

test('one entry per code, links in sheet order, ALTERNATE DRAWING ignored', () => {
  const map = drawingsByCode(tab([
    row('RXS140009', TAIL, SEAL),
    row('RXS140009', DRIVE),
    row('RER020017', SEAL),
  ]))
  assert.equal(map.get('RXS140009'), `${TAIL}, ${DRIVE}`)
  assert.equal(map.get('RER020017'), SEAL)
  assert.equal(map.size, 2)
})

test('a link repeated with ?usp=... is one drawing; the first form seen is kept', () => {
  const map = drawingsByCode(tab([
    row('RXS140011', `${TAIL}?usp=sharing`),
    row('RXS140011', TAIL),
    row('RXS140011', `${TAIL}?usp=drive_link`),
  ]))
  assert.equal(map.get('RXS140011'), `${TAIL}?usp=sharing`)
})

test('a code listed without a usable link maps to blank', () => {
  const map = drawingsByCode(tab([
    row('RXH010069', ''),
    row('RED020013', 'DRAWING MISSING – ask Washim'),
  ]))
  assert.equal(map.get('RXH010069'), '')
  assert.equal(map.get('RED020013'), '')
})

test('a repeated header row and blank codes are skipped', () => {
  const map = drawingsByCode(tab([
    HEADERS,
    row('', SEAL),
    row('RER020017', SEAL),
  ]))
  assert.deepEqual([...map.keys()], ['RER020017'])
})

test('codes are trimmed and upper-cased', () => {
  const map = drawingsByCode(tab([row(' rxs140009 ', TAIL)]))
  assert.equal(map.get('RXS140009'), TAIL)
})

test('a renamed DRAWING LINK column fails loudly', () => {
  assert.throws(
    () => drawingsByCode(tab([], ['RM CODE', 'DRAWING URL'])),
    /missing required column\(s\): DRAWING LINK/,
  )
})
