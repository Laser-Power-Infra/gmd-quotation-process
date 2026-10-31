import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planIndentRmCodes,
  planRmCodeWrites,
  rmCodeSizeKey,
  rmCodeRequiredMaterial,
  RM_CODE_CARBON_STEEL,
  type IndentRmCodeInput,
  type RawMaterialMatchRow,
} from '../lib/indentRmCodeResolver.js'

function indent(overrides: Partial<IndentRmCodeInput> = {}): IndentRmCodeInput {
  return {
    id: 'a',
    item: 'SLV',
    size: '200',
    pnRating: 'PN-10/16',
    v1: '10',
    v2: '',
    v3: '',
    v4: '',
    v1Category: 'Base',
    v2Category: '',
    v3Category: '',
    v4Category: '',
    ...overrides,
  }
}

function rm(overrides: Partial<RawMaterialMatchRow> = {}): RawMaterialMatchRow {
  return {
    erpItemCode: 'RSD120003',
    l2ValveType: 'SLUICE VALVE',
    l3Dia: '200MM',
    l4Component: 'METAL TO RUBBER',
    l5Material: 'DUCTILE IRON',
    l6Std: 'NON-RISING',
    l7Dimension: 'PN-16',
    l8ItemCategory: 'TRADING VALVES',
    ...overrides,
  }
}

test('size keys strip the unit suffix', () => {
  assert.equal(rmCodeSizeKey('200MM'), '200')
  assert.equal(rmCodeSizeKey('200 mm'), '200')
  assert.equal(rmCodeSizeKey(' 200 '), '200')
  assert.equal(rmCodeSizeKey('12.5MM'), '12.5')
  assert.equal(rmCodeSizeKey('6IN'), '6')
  assert.equal(rmCodeSizeKey(''), '')
  assert.equal(rmCodeSizeKey(null), '')
})

test('V1 resolves to the NON-RISING raw material', () => {
  const plan = planIndentRmCodes([indent()], [rm()])
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.unmatched, 0)
})

test('each V slot maps to its own L6 standard', () => {
  const raw = [
    rm({ erpItemCode: 'V1CODE', l6Std: 'NON-RISING' }),
    rm({ erpItemCode: 'V2CODE', l6Std: 'NON-RISING-9523' }),
    rm({ erpItemCode: 'V3CODE', l6Std: 'RISING' }),
    rm({ erpItemCode: 'V4CODE', l6Std: 'RISING-9523' }),
  ]
  const plan = planIndentRmCodes(
    [indent({ v1: '1', v2: '2', v3: '3', v4: '4' })],
    raw,
  )
  const u = plan.updates[0]
  assert.equal(u.rmCodeV1, 'V1CODE')
  assert.equal(u.rmCodeV2, 'V2CODE')
  assert.equal(u.rmCodeV3, 'V3CODE')
  assert.equal(u.rmCodeV4, 'V4CODE')
  assert.equal(plan.resolved, 4)
})

test('SLV maps to METAL TO RUBBER and SLV METAL to METAL TO METAL', () => {
  const raw = [
    rm({ erpItemCode: 'RUBBER1', l4Component: 'METAL TO RUBBER' }),
    rm({ erpItemCode: 'METAL1', l4Component: 'METAL TO METAL' }),
  ]
  const slv = planIndentRmCodes([indent({ item: 'SLV' })], raw)
  assert.equal(slv.updates[0].rmCodeV1, 'RUBBER1')

  const metal = planIndentRmCodes([indent({ item: 'SLV METAL' })], raw)
  assert.equal(metal.updates[0].rmCodeV1, 'METAL1')
})

test('TPAV+SLV resolves like SLV for the same size/PN/slot', () => {
  // TPAV+SLV's sluice-valve body is a plain SLV, so it shares SLV's L4 component
  // and must resolve to the same raw material code the SLV row does.
  const raw = [
    rm({ erpItemCode: 'V1CODE', l6Std: 'NON-RISING' }),
    rm({ erpItemCode: 'V3CODE', l6Std: 'RISING' }),
  ]
  const slv = planIndentRmCodes(
    [indent({ item: 'SLV', v1: '1', v3: '1', v3Category: 'Rising' })],
    raw,
  )
  const tpav = planIndentRmCodes(
    [indent({ item: 'TPAV+SLV', v1: '1', v3: '1', v3Category: 'Rising' })],
    raw,
  )
  assert.equal(tpav.updates.length, 1)
  assert.deepEqual(
    [tpav.updates[0].rmCodeV1, tpav.updates[0].rmCodeV3],
    [slv.updates[0].rmCodeV1, slv.updates[0].rmCodeV3],
  )
  assert.equal(tpav.updates[0].rmCodeV1, 'V1CODE')
  assert.equal(tpav.updates[0].rmCodeV3, 'V3CODE')
})

test('the PN rating is bucketed on both sides', () => {
  // "PN - 16" on the raw material side must meet "PN-10/16" on the indent side.
  const plan = planIndentRmCodes(
    [indent({ pnRating: 'PN-10/16' })],
    [rm({ l7Dimension: 'PN - 16' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')

  // A different bucket must not match.
  const miss = planIndentRmCodes(
    [indent({ pnRating: 'PN-10/16' })],
    [rm({ l7Dimension: 'PN - 25' })],
  )
  assert.equal(miss.updates[0].rmCodeV1, '')
  assert.equal(miss.unmatched, 1)
})

test('the item category is matched on L8 and the valve type on L2', () => {
  const wrongCategory = planIndentRmCodes(
    [indent()],
    [rm({ l8ItemCategory: 'SPARES' })],
  )
  assert.equal(wrongCategory.updates[0].rmCodeV1, '')

  const wrongValveType = planIndentRmCodes(
    [indent()],
    [rm({ l2ValveType: 'BUTTERFLY VALVE' })],
  )
  assert.equal(wrongValveType.updates[0].rmCodeV1, '')
})

test('duplicate erpItemCode rows collapse to a single code', () => {
  // GMDUpdateItem has no unique index on erpItemCode, so a sheet can repeat one.
  const plan = planIndentRmCodes([indent()], [rm(), rm()])
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.ambiguous, 0)
})

test('several candidates resolve to ONE code and count as ambiguous', () => {
  const plan = planIndentRmCodes(
    [indent()],
    [rm({ erpItemCode: 'RSD110004' }), rm({ erpItemCode: 'RSD110041' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD110004')
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.resolved, 0)
})

test('ties are broken by code order so the output is stable', () => {
  const plan = planIndentRmCodes(
    [indent()],
    [rm({ erpItemCode: 'ZZZ999999' }), rm({ erpItemCode: 'AAA111111' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'AAA111111')
})

test('an empty V column is never matched', () => {
  const plan = planIndentRmCodes([indent({ v1: '' })], [rm()])
  assert.equal(plan.updates[0].rmCodeV1, '')
  // Nothing was populated, so nothing was resolved or counted as unmatched.
  assert.equal(plan.resolved, 0)
  assert.equal(plan.unmatched, 0)
})

test('a zero balance still counts as a populated variant', () => {
  const plan = planIndentRmCodes([indent({ v1: '0' })], [rm()])
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
})

test('a CS category requires a carbon steel raw material', () => {
  // "Rising CS" records the body material (cast/carbon steel), so it must not
  // be satisfied by a ductile iron code of the wrong material.
  const plan = planIndentRmCodes(
    [
      indent({
        v1: '',
        v2: '',
        v3: '8',
        v3Category: 'Rising CS',
      }),
    ],
    [rm({ l6Std: 'RISING' })],
  )
  assert.equal(plan.updates[0].rmCodeV3, '')
  assert.equal(plan.unmatched, 1)
})

test('a CS category matches a carbon steel raw material when one exists', () => {
  const plan = planIndentRmCodes(
    [indent({ v1: '', v3: '8', v3Category: 'Rising CS' })],
    [
      rm({ erpItemCode: 'RGS010014', l6Std: 'RISING', l5Material: RM_CODE_CARBON_STEEL }),
      rm({ erpItemCode: 'RSD110003', l6Std: 'RISING' }),
    ],
  )
  assert.equal(plan.updates[0].rmCodeV3, 'RGS010014')
  assert.equal(plan.resolved, 1)
})

test('a non-CS category requires ductile iron', () => {
  const plan = planIndentRmCodes(
    [indent({ v1Category: 'Base' })],
    [rm(), rm({ erpItemCode: 'OTHER1', l5Material: RM_CODE_CARBON_STEEL })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
  assert.equal(plan.resolved, 1)
})

test('a blank category falls back to the slot default (ductile iron)', () => {
  const plan = planIndentRmCodes(
    [indent({ v1Category: '' })],
    [rm(), rm({ erpItemCode: 'OTHER1', l5Material: RM_CODE_CARBON_STEEL })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
})

test('the material requirement is read from the slot category only', () => {
  // A CS label on a different slot must not affect this one.
  const plan = planIndentRmCodes(
    [indent({ v1: '1', v1Category: 'Base', v2: '2', v2Category: 'Rising CS' })],
    [
      rm({ erpItemCode: 'V1CODE', l6Std: 'NON-RISING' }),
      rm({ erpItemCode: 'V2CS', l6Std: 'NON-RISING-9523' }),
    ],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'V1CODE')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.unmatched, 1)
})

test('rmCodeRequiredMaterial only constrains on a CS token', () => {
  assert.equal(rmCodeRequiredMaterial('Rising CS'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('rising cs'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('Base, Rising CS'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('Base'), null)
  assert.equal(rmCodeRequiredMaterial('9523'), null)
  assert.equal(rmCodeRequiredMaterial('Rising 9523'), null)
  assert.equal(rmCodeRequiredMaterial('Rising'), null)
  assert.equal(rmCodeRequiredMaterial('CS2'), null)
  assert.equal(rmCodeRequiredMaterial(''), null)
  assert.equal(rmCodeRequiredMaterial(null), null)
})

test('rows for items without a resolver are skipped entirely', () => {
  const raw = [rm()]
  for (const item of ['CF', 'DV', 'GV', null]) {
    const plan = planIndentRmCodes([indent({ item })], raw)
    assert.equal(plan.updates.length, 0, `expected ${item} to be skipped`)
  }
})

function nrvRm(overrides: Partial<RawMaterialMatchRow> = {}): RawMaterialMatchRow {
  return rm({
    erpItemCode: 'NRV120003',
    l2ValveType: 'CHECK VALVE',
    l4Component: 'STD',
    l6Std: 'SWING TYPE',
    ...overrides,
  })
}

test('NRV V1 resolves to the SWING TYPE raw material and V2 to SWING TYPE 9523', () => {
  const plan = planIndentRmCodes(
    [indent({ item: 'NRV', v1: '1', v2: '2' })],
    [
      nrvRm({ erpItemCode: 'NRV-SWING', l6Std: 'SWING TYPE' }),
      nrvRm({ erpItemCode: 'NRV-SWING-9523', l6Std: 'SWING TYPE 9523' }),
    ],
  )
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].rmCodeV1, 'NRV-SWING')
  assert.equal(plan.updates[0].rmCodeV2, 'NRV-SWING-9523')
  assert.equal(plan.updates[0].rmCodeV3, '')
  assert.equal(plan.updates[0].rmCodeV4, '')
  assert.equal(plan.resolved, 2)
})

test('NRV matches a hyphen-separated SWING TYPE-9523 standard too', () => {
  const plan = planIndentRmCodes(
    [indent({ item: 'NRV', v1: '', v2: '2' })],
    [nrvRm({ erpItemCode: 'NRV-SWING-9523', l6Std: 'SWING TYPE-9523' })],
  )
  assert.equal(plan.updates[0].rmCodeV2, 'NRV-SWING-9523')
})

test('NRV does not constrain the L4 component', () => {
  const plan = planIndentRmCodes(
    [indent({ item: 'NRV' })],
    [nrvRm({ l4Component: 'SOMETHING ELSE' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'NRV120003')
})

test('NRV requires L2 CHECK VALVE and never matches a sluice-valve raw material', () => {
  const wrongValve = planIndentRmCodes(
    [indent({ item: 'NRV' })],
    [nrvRm({ l2ValveType: 'SLUICE VALVE' })],
  )
  assert.equal(wrongValve.updates[0].rmCodeV1, '')
  assert.equal(wrongValve.unmatched, 1)

  // A populated V3/V4 has no CHECK VALVE standard, so it is left blank without
  // being counted as unmatched.
  const spare = planIndentRmCodes(
    [indent({ item: 'NRV', v1: '', v3: '1', v4: '1' })],
    [nrvRm()],
  )
  assert.equal(spare.updates[0].rmCodeV3, '')
  assert.equal(spare.updates[0].rmCodeV4, '')
  assert.equal(spare.unmatched, 0)
})

test('rows without a usable size or PN rating are skipped', () => {
  assert.equal(planIndentRmCodes([indent({ size: null })], [rm()]).updates.length, 0)
  assert.equal(planIndentRmCodes([indent({ size: '  ' })], [rm()]).updates.length, 0)
  assert.equal(planIndentRmCodes([indent({ pnRating: null })], [rm()]).updates.length, 0)
})

test('raw materials with a blank code or a blank key part are ignored', () => {
  assert.equal(planIndentRmCodes([indent()], [rm({ erpItemCode: '  ' })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l3Dia: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l4Component: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l6Std: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l7Dimension: null })]).unmatched, 1)
})

test('the resolver reports a count for every populated slot', () => {
  const raw = [
    rm({ erpItemCode: 'HIT1' }),
    rm({ erpItemCode: 'HIT2' }),
    rm({ erpItemCode: 'RISING1', l6Std: 'RISING' }),
  ]
  const plan = planIndentRmCodes(
    [
      // v1 matches two raw materials, v3 matches one, v2 and v4 match none.
      indent({ id: 'r1', v1: '1', v2: '1', v3: '1', v4: '1' }),
      // A size with no raw material at all.
      indent({ id: 'r2', size: '999' }),
    ],
    raw,
  )
  assert.equal(plan.updates.length, 2)
  assert.equal(plan.updates[0].rmCodeV1, 'HIT1')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.updates[0].rmCodeV3, 'RISING1')
  assert.equal(plan.updates[0].rmCodeV4, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.unmatched, 3)
  // Nothing is double counted: all 5 populated slots land in exactly one bucket.
  assert.equal(plan.resolved + plan.ambiguous + plan.unmatched, 5)
})

test('a blank planned value is never written over a stored code', () => {
  const plan = planIndentRmCodes([indent({ id: 'r1' })], [])
  const current = new Map([
    [
      'r1',
      { rmCodeV1: 'MANUAL1', rmCodeV2: '', rmCodeV3: '', rmCodeV4: '' },
    ],
  ])
  // The resolver has no raw material, so every slot plans blank: nothing to do.
  assert.deepEqual(planRmCodeWrites(plan.updates, current), [])
})

test('only blank stored slots are filled; existing codes are never overwritten', () => {
  const planned = [
    {
      id: 'r1',
      rmCodeV1: 'NEW1',
      rmCodeV2: 'NEW2',
      rmCodeV3: '',
      rmCodeV4: 'NEW4',
    },
  ]
  const current = new Map([
    [
      'r1',
      { rmCodeV1: 'CURATED1', rmCodeV2: null, rmCodeV3: '', rmCodeV4: '  ' },
    ],
  ])
  assert.deepEqual(planRmCodeWrites(planned, current), [
    { id: 'r1', rmCodeV2: 'NEW2', rmCodeV4: 'NEW4' },
  ])
})

test('a row whose slots all match is dropped from the writes', () => {
  const planned = [
    { id: 'r1', rmCodeV1: 'SAME', rmCodeV2: '', rmCodeV3: '', rmCodeV4: '' },
  ]
  const current = new Map([
    ['r1', { rmCodeV1: 'SAME', rmCodeV2: '', rmCodeV3: '', rmCodeV4: '' }],
  ])
  assert.deepEqual(planRmCodeWrites(planned, current), [])
})

function typed(type: string, code: string, o: Partial<RawMaterialMatchRow> = {}): RawMaterialMatchRow {
  return rm({
    erpItemCode: code,
    l2ValveType: type,
    l4Component: 'STD',
    l6Std: 'FLANGE TYPE',
    itemNameAuto: 'TV-' + code,
    ...o,
  })
}

const one = (item: string, raw: RawMaterialMatchRow[], o: Partial<IndentRmCodeInput> = {}) =>
  planIndentRmCodes([indent({ item, ...o })], raw).updates[0]

test('BFV Base prefers BLANK BASE, then falls back to whatever has stock', () => {
  const raw = [
    typed('BUTTERFLY VALVE', 'GEAR', { l4Component: 'GEAR OP', availableStock: '9' }),
    typed('BUTTERFLY VALVE', 'BLANK', { l4Component: 'BLANK BASE' }),
  ]
  assert.equal(one('BFV', raw).rmCodeV1, 'BLANK')
  // 9523 has no blank base: gear op is used.
  const r9523 = [typed('BUTTERFLY VALVE', 'G9523', { l4Component: 'GEAR OP', l6Std: 'FLANGE TYPE-9523' })]
  assert.equal(one('BFV', r9523, { v1: '', v2: '1', v2Category: '9523' }).rmCodeV2, 'G9523')
})

test('BFV 700/800 and CS BFVs are production items and stay blank', () => {
  const raw = ['700MM', '800MM'].map((d) => typed('BUTTERFLY VALVE', 'BLANK', { l3Dia: d, l4Component: 'BLANK BASE' }))
  assert.equal(one('BFV', raw, { size: '700' }).rmCodeV1, '')
  assert.equal(one('BFV', raw, { size: '800' }).rmCodeV1, '')
  const cs = [typed('BUTTERFLY VALVE', 'CSB', { l5Material: RM_CODE_CARBON_STEEL })]
  const plan = planIndentRmCodes([indent({ item: 'BFV', v1Category: 'CS' })], cs)
  assert.equal(plan.updates[0].rmCodeV1, '')
  assert.equal(plan.unmatched, 0)
})

test('BFV wafer needs WAFER TYPE and flange needs a non-wafer', () => {
  const raw = [
    typed('BUTTERFLY VALVE', 'FLG'),
    typed('BUTTERFLY VALVE', 'WAF', { l6Std: 'WAFER TYPE' }),
  ]
  assert.equal(one('BFV', raw, { v1Category: 'Wafer' }).rmCodeV1, 'WAF')
  assert.equal(one('BFV', raw, { v1Category: 'Base' }).rmCodeV1, 'FLG')
})

test('TPAV matches on size alone, ignoring PN and category', () => {
  const raw = [typed('TPAV', 'TPAV100', { l3Dia: '100MM', l7Dimension: 'PN-16' })]
  const u = one('TPAV', raw, { size: '100', pnRating: 'PN-20/25/30', v1Category: 'Base', v2: '1', v2Category: '9523' })
  assert.equal(u.rmCodeV1, 'TPAV100')
  assert.equal(u.rmCodeV2, 'TPAV100')
})

test('TPAV 20/25 mm use the small-orifice code', () => {
  const raw = [
    typed('TPAV', 'SMALL', { l3Dia: '12.5MM' }),
    typed('TPAV', 'TPAV25', { l3Dia: '25MM' }),
  ]
  assert.equal(one('TPAV', raw, { size: '20' }).rmCodeV1, 'SMALL')
  assert.equal(one('TPAV', raw, { size: '25' }).rmCodeV1, 'SMALL')
})

test('TPAV and TPAV+SLV append the isolating sluice valve', () => {
  const raw = [
    typed('TPAV', 'TPAV80', { l3Dia: '80MM' }),
    rm({ erpItemCode: 'SLV80', l3Dia: '80MM', itemNameAuto: 'TV-SLV80' }),
    rm({ erpItemCode: 'SLV80R', l3Dia: '80MM', l6Std: 'RISING', itemNameAuto: 'TV-SLV80R' }),
  ]
  assert.equal(one('TPAV', raw, { size: '80' }).rmCodeV1, 'TPAV80, SLV80')
  const plus = one('TPAV+SLV', raw, { size: '80', v3: '1', v3Category: 'Rising' })
  assert.equal(plus.rmCodeV1, 'TPAV80, SLV80')
  assert.equal(plus.rmCodeV3, 'TPAV80, SLV80R')
})

test('a category with several parts yields a code for each, joined', () => {
  const raw = [
    rm({ erpItemCode: 'RIS', l6Std: 'RISING' }),
    rm({ erpItemCode: 'RISCS', l6Std: 'RISING', l5Material: RM_CODE_CARBON_STEEL }),
  ]
  const u = one('SLV', raw, { v1: '', v3: '1', v3Category: 'Rising, Rising CS' })
  assert.equal(u.rmCodeV3, 'RIS, RISCS')
})

test('ranking: TV- name, item preference, exact PN, stock', () => {
  const dpcv = [
    typed('DPCV', 'A', { l4Component: 'SPRING LOADED' }),
    typed('DPCV', 'B', { l4Component: 'METAL TO RUBBER' }),
  ]
  assert.equal(one('DPCV', dpcv).rmCodeV1, 'B')
  const prv = [
    typed('PRESSURE REDUCING VALVE', 'A', { l6Std: 'DS-1 TYPE' }),
    typed('PRESSURE REDUCING VALVE', 'B', { l6Std: 'CONTROL-DIAPHRAGM TYPE' }),
  ]
  assert.equal(one('PRV', prv).rmCodeV1, 'B')
  const tv = [rm({ erpItemCode: 'A1' }), rm({ erpItemCode: 'B1', itemNameAuto: 'TV-X' })]
  assert.equal(one('SLV', tv).rmCodeV1, 'B1')
  const pn = [rm({ erpItemCode: 'A1', l7Dimension: 'PN-10' }), rm({ erpItemCode: 'B1' })]
  assert.equal(one('SLV', pn).rmCodeV1, 'B1')
  const stock = [rm({ erpItemCode: 'A1' }), rm({ erpItemCode: 'B1', availableStock: '3' })]
  assert.equal(one('SLV', stock).rmCodeV1, 'B1')
})

test('excluded L4 values (sample, bonnet, disc, cover) are never picked', () => {
  const raw = [
    typed('CHECK VALVE', 'SAMPLE', { l6Std: 'SWING TYPE', l4Component: 'SAMPLE FOR BIS' }),
    typed('CHECK VALVE', 'REAL', { l6Std: 'SWING TYPE', l4Component: 'METAL TO METAL' }),
  ]
  assert.equal(one('NRV', raw).rmCodeV1, 'REAL')
})

test('air cushion PN-16 reuses CLASS 150 codes and ignores material', () => {
  const raw = [
    typed('AIR CUSHION VALVE', 'AC150', { l7Dimension: 'CLASS 150#', l5Material: 'MILD STEEL' }),
  ]
  assert.equal(one('AIR CUSHION', raw).rmCodeV1, 'AC150')
})
