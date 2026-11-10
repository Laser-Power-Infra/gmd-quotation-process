import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { readActuatorWorkbook } from '../lib/actuatorMaster.js'
import { actuatorBomLines, createDraftLines, isErpCode, mismatchReport, resolveStockCodes, stockSummary } from '../lib/actuatorStock.js'

const WB = path.resolve(import.meta.dirname, '../../../tmp/GMD_Actuator_Master.xlsx')
const stock = [
  { erpCode: 'RCB040002', actCode: 'ACT-RT-K150' }, { erpCode: 'RCD020022', actCode: 'ACT-RT-K150' },
  { erpCode: 'RZZ010001', actCode: null },
]

test('isErpCode: real codes only, MAPPING text is not a code', () => {
  for (const c of ['RCB040002', 'RL2010003', 'RED070005']) assert.equal(isErpCode(c), true)
  for (const c of ['Bevel/spur – see GMD_GB_STOCK', 'none in stock', '(no ERP code)', '', null, 'GB-AU-125.3']) assert.equal(isErpCode(c), false)
})

test('resolveStockCodes: K150 maps to its ERP codes, AUMA none, non-code gearbox text is no code', () => {
  assert.deepEqual(resolveStockCodes({ actCode: 'ACT-RT-K150' }, 'Bevel/spur – see GMD_GB_STOCK', stock), { act: ['RCB040002', 'RCD020022'], gb: null })
  assert.deepEqual(resolveStockCodes({ actCode: 'ACT-AU-SA14.2', gbCode: 'GB-AU-125.3' }, 'RL2010003', stock), { act: [], gb: 'RL2010003' })
  assert.equal(resolveStockCodes({ gbCode: 'RED070005' }, 'RL2010003', stock).gb, 'RED070005')
})

test('stockSummary: free qty summed per code, short when below docket qty, no code is not short', () => {
  const live = new Map([['RCB040002', 2], ['RCD020022', 1], ['RL2010003', 10]])
  const codes = resolveStockCodes({ actCode: 'ACT-RT-K150' }, 'RL2010003', stock)
  const s = stockSummary({ actCode: 'ACT-RT-K150' }, codes, live, 5)
  assert.equal(s.actFree, 3); assert.equal(s.gbFree, 10); assert.deepEqual(s.short, ['actuator'])
  assert.deepEqual(stockSummary({}, { act: [], gb: null }, live, 5).short, [])
  assert.deepEqual(stockSummary({ actCode: 'ACT-RT-K150' }, codes, live, 3).short, [])
})

test('actuatorBomLines: gearbox and best-stocked actuator added once', () => {
  const live = new Map([['RCB040002', 1], ['RCD020022', 4]])
  const codes = { act: ['RCB040002', 'RCD020022'], gb: 'RL2010003' }
  assert.deepEqual(actuatorBomLines(codes, live, [{ code: 'RSD110023', qty: 1 }]), [{ code: 'RCD020022', qty: 1 }, { code: 'RL2010003', qty: 1 }])
  assert.deepEqual(actuatorBomLines(codes, live, [{ code: 'rl2010003', qty: 1 }, { code: 'RCD020022', qty: 1 }]), [])
})

test('real workbook: BFV ACT+GB gets RL2010003; K150 codes; mismatch counts', { skip: !existsSync(WB) }, () => {
  const p = readActuatorWorkbook(WB)
  const act = p.actuatorStock as any[]
  const m = p.mappings.filter((x: any) => /RL2010003/.test(String(x.gmdGbCode))) as any[]
  assert.ok(m.length > 0)
  const bom = actuatorBomLines(resolveStockCodes({ actCode: null }, m[0].gmdGbCode, act), new Map(), [])
  assert.ok(bom.some((l) => l.code === 'RL2010003'))
  assert.ok(resolveStockCodes({ actCode: 'ACT-RT-K150' }, null, act).act.includes('RCB040002'))
  const r = mismatchReport(act, p.gearboxStock as any[])
  console.log(JSON.stringify({ ...r.totals, erpMismatch: r.erpMismatch.length, gbCoded: r.gearboxCoded.length, gbNeedsCode: r.gearboxNeedsCode.map((g) => [g.erpCode, g.available]), aumaToFill: r.aumaToFill.length, statusMismatch: act.filter((a) => a.status === 'ERP MISMATCH').length }))
  assert.equal(r.gearboxNeedsCode.length, 1)
})

// ---- Fix round 1 ----
import { twoToOneUpdate } from '../lib/actuatorCost.js'
import { classifyBom } from '../lib/bomClassify.js'
import { computeBomUseStatus, dropActuatorRows, pickBomComponentCode } from '../lib/verifyBomLookup.js'
import { stockLabel } from '../lib/actuatorStock.js'

test('twoToOneUpdate: actuated items send the 2:1 sum as productCost, others keep writing cost', () => {
  assert.deepEqual(twoToOneUpdate({ operationType: 'ACT+GB', itemType: 'BUTTERFLY VALVE', actCode: 'A' }, 100), { productCost: 100 })
  assert.deepEqual(twoToOneUpdate({ operationType: 'MANUAL', itemType: 'ACTUATOR', actuatorBreakdown: {} }, 100), { productCost: 100 })
  assert.deepEqual(twoToOneUpdate({ operationType: 'ACT', itemType: 'BUTTERFLY VALVE' }, 100), { cost: 100 }) // legacy unlinked ACT row
  assert.deepEqual(twoToOneUpdate({ operationType: 'GEAR', itemType: 'BUTTERFLY VALVE', actCode: 'A' }, 100), { cost: 100 })
})

const rm = (c: string) => ({ rawMaterial: { erpItemCode: c }, fullItem: null })
const skip = new Set(['RL2010003', 'RCB040002'])

test('pickBomComponentCode: skip applies only when passed (non-actuated behaves as before)', () => {
  const comps = [rm('RL2010003'), rm('RSD110023')]
  assert.equal(pickBomComponentCode('X', comps), 'RL2010003')
  assert.equal(pickBomComponentCode('X', comps, skip), 'RSD110023')
  assert.equal(pickBomComponentCode('X', [rm('RL2010003')], skip), null) // actuated BOM of only skipped codes: no cost component
})

test('BOM use status and type ignore actuator / gearbox lines', () => {
  const row = (c: string) => ({ itemCode: 'X', rmItemCode: c, bomIdType: '2:1' })
  const rows = [row('RSD1'), row('RSD2'), row('RL2010003'), row('RCB040002')]
  assert.equal(computeBomUseStatus(rows), 'NO USE')
  assert.equal(computeBomUseStatus(dropActuatorRows(rows, skip)), 'USE')
  assert.equal(dropActuatorRows([row('RL2010003')], skip).length, 1) // only-gearbox BOM left as it is
  const l = (code: string) => ({ code, isFullItem: false, open: true })
  const lines = [l('RSD1'), l('RSD2'), l('RL2010003'), l('RCB040002')]
  assert.equal(classifyBom(lines), 'Create BOM / Production item')
  assert.equal(classifyBom(lines, skip), '2:1')
  assert.equal(classifyBom([l('RL2010003')], skip), classifyBom([l('RL2010003')]))
})

test('stockLabel: OK only for what was checked', () => {
  const base = { actCode: null, gbCode: null, actErp: [], gbErp: null, need: 5, short: [] as string[] }
  assert.equal(stockLabel({ ...base, actFree: null, gbFree: null }), 'No stock code')
  assert.equal(stockLabel({ ...base, actFree: null, gbFree: 9 }), 'gearbox stock OK')
  assert.equal(stockLabel({ ...base, actFree: 9, gbFree: 9 }), 'actuator + gearbox stock OK')
  assert.equal(stockLabel({ ...base, actFree: 1, gbFree: 9, short: ['actuator'] }), 'Short: actuator stock')
})

test('CREATE / Auto BOM draft gets the actuator and gearbox lines (same builder as EDIT), minus stale ones', () => {
  const codes = { act: ['RCB040002', 'RCD020022'], gb: 'RL2010003' }
  const live = new Map([['RCD020022', 5]])
  const copied = [{ code: 'RM1', qty: 2 }, { code: 'RCB040002', qty: 1 }] // nearest BOM carried another size's actuator
  assert.deepEqual(createDraftLines(copied, new Set(['RCB040002']), codes, live), [{ code: 'RM1', qty: 2 }, { code: 'RCD020022', qty: 1 }, { code: 'RL2010003', qty: 1 }])
  assert.deepEqual(createDraftLines([], new Set(), codes, live), actuatorBomLines(codes, live, []))
})
