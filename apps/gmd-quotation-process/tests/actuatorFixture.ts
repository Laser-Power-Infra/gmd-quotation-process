// Rows of the live actuator master sheet (20 Nov 2026), trimmed to the columns the actuator / gearbox pick reads.
import type { Master } from '../lib/actuatorSelect.js'
import { parseImported } from '../lib/actuatorMaster.js'

const SA = 'SA (AUMA India)'
const K = 'K-series (GMD stock)'

/** AUMA_RANGE speed table, 3-ph rows: [model, slowest rpm, fastest rpm, max torque, lower torque, from this rpm up]. */
const AUMA_3PH: [string, number, number, number, number?, number?][] = [
  ['SA 3', 11, 180, 30], ['SA 6', 4, 180, 60, 55, 125], ['SA 12', 4, 180, 120, 110, 90], ['SA 15', 4, 90, 150],
  ['SA 25', 4, 180, 250, 220, 125], ['SA 30', 4, 180, 300, 264, 125], ['SA 50', 4, 180, 500, 450, 125],
  ['SA 60', 4, 180, 600, 540, 125], ['SA 100', 4, 180, 1000, 900, 125],
]
const AUMA_RPM = [4, 5.6, 8, 11, 16, 22, 32, 45, 63, 90, 125, 180]
export const AUMA_SPEEDS = AUMA_3PH.flatMap(([model, lo, hi, t, low, from]) =>
  AUMA_RPM.filter((r) => r >= lo && r <= hi).map((rpm) => ({ model, phase: '3-ph 415 V', rpm, torque: from && rpm >= from ? low! : t })))

/** AUMA_ROTORK_ALT as the live sheet returns it (header row 4, nine model rows, a footnote). */
export const ALT_ROWS: unknown[][] = [
  ['AUMA India ↔ Rotork K-series — alternate models (3-ph 415 V, on-off, integral starter). Matched on RATED torque.'],
  ['Rotork rated torques from GMD Technical Master Data › ACUATOR-MODEL NO; AUMA from AUMA India data sheet SA3–SA100. Price = basic ex-works, GST extra.'],
  [],
  ['AUMA MODEL', 'AUMA MAX TORQUE (Nm)', 'AUMA SPEEDS (rpm)', 'AUMA PRICE (₹)', 'ROTORK ALTERNATE', 'ROTORK RATED TORQUE (Nm)', 'ROTORK SPEEDS (rpm)', 'ROTORK PRICE (₹)', 'CHEAPER', 'REMARK', 'AUMA RM CODE (generic)', 'ROTORK RM CODE (generic)'],
  ['SA 3', 30, '11–180', 54900, 'K 30', 34, '4.5–192 (25 Nm at 144/192)', 53664, 'Rotork', '', 'RCC010015', 'RCC010052'],
  ['SA 6', 60, '4–180 (55 Nm at 125/180)', 54900, 'K 60', 61, '4.5–192 (54/41 Nm at 144/192)', 56901, 'AUMA', '', 'RCC010047', 'RCC010056'],
  ['SA 12', 120, '4–180 (110 Nm at 90+)', 56500, 'K 150', 152, '4.5–192 (115 at 12; 108/102 at 144/192)', 57912, 'AUMA', 'No Rotork between 61 and 152 Nm', 'RCC010028', 'RCC010058'],
  ['SA 15', 150, '4–90', 57500, 'K 150', 152, '4.5–192', 57912, 'AUMA', '', 'RCC030002', 'RCC010058'],
  ['SA 25', 250, '4–180 (220 Nm at 125/180)', 67000, 'K 300', 305, '4.5–192 (271/220 at 144/192)', 74461, 'AUMA', '', 'RCC010021', 'RCC010054'],
  ['SA 30', 300, '4–180 (264 Nm at 125/180)', 70000, 'K 300', 305, '4.5–192', 74461, 'AUMA', '', 'RCC010003', 'RCC010054'],
  ['SA 50', 500, '4–180 (450 Nm at 125/180)', 94400, 'K 500 / K 600', '500 (36 rpm only) / 610', 'K600 4.5–192 (529 at 6, 441 at 12, 434 at 192)', 89849, 'Rotork (K 600)', 'SA 50 price is estimate; K 500 not priced', 'NEW code', 'RCC010057'],
  ['SA 60', 600, '4–180 (540 Nm at 125/180)', 104900, 'K 600', 610, '4.5–192', 89849, 'Rotork', 'SA 60 price is estimate', 'NEW code', 'RCC010057'],
  ['SA 100', 1000, '4–180 (900 Nm at 125/180)', 141500, 'K 1000', 1017, '4.5–192 (881 at 4.5/144, 800 at 192)', '', 'RFQ both', 'AUMA price = SAR 100 regulating (ceiling); K 1000 & K 800 (800 Nm @36) not priced', 'NEW code', 'NEW code (K 1000)'],
  ['Single-phase: only AUMA (SA 3–SA 60, max 60 s per stroke) — see AUMA_RANGE. Rotork K single-phase not on record.'],
]

/** What the parser reads from ALT_ROWS (actuatorMaster.test.ts checks it). */
export const ROTORK_DERATES = [
  { model: 'K30', rpm: 144, torque: 25 }, { model: 'K30', rpm: 192, torque: 25 },
  { model: 'K60', rpm: 144, torque: 54 }, { model: 'K60', rpm: 192, torque: 41 },
  { model: 'K150', rpm: 12, torque: 115 }, { model: 'K150', rpm: 144, torque: 108 }, { model: 'K150', rpm: 192, torque: 102 },
  { model: 'K300', rpm: 144, torque: 271 }, { model: 'K300', rpm: 192, torque: 220 },
  { model: 'K600', rpm: 6, torque: 529 }, { model: 'K600', rpm: 12, torque: 441 }, { model: 'K600', rpm: 192, torque: 434 },
  { model: 'K1000', rpm: 4.5, torque: 881 }, { model: 'K1000', rpm: 144, torque: 881 }, { model: 'K1000', rpm: 192, torque: 800 },
]
const rm = (make: 'AUMA' | 'Rotork', model: string, code: string | null) => ({ make, model, code })
export const RM_CODES = [
  rm('AUMA', 'SA 3', 'RCC010015'), rm('Rotork', 'K30', 'RCC010052'), rm('AUMA', 'SA 6', 'RCC010047'), rm('Rotork', 'K60', 'RCC010056'),
  rm('AUMA', 'SA 12', 'RCC010028'), rm('Rotork', 'K150', 'RCC010058'), rm('AUMA', 'SA 15', 'RCC030002'), rm('Rotork', 'K150', 'RCC010058'),
  rm('AUMA', 'SA 25', 'RCC010021'), rm('Rotork', 'K300', 'RCC010054'), rm('AUMA', 'SA 30', 'RCC010003'), rm('Rotork', 'K300', 'RCC010054'),
  rm('AUMA', 'SA 50', null), rm('Rotork', 'K500', 'RCC010057'), rm('Rotork', 'K600', 'RCC010057'),
  rm('AUMA', 'SA 60', null), rm('Rotork', 'K600', 'RCC010057'), rm('AUMA', 'SA 100', null), rm('Rotork', 'K1000', null),
]

// GB_MASTER Viral 19-Nov tables as parsed (20 Nov): [GB CODE, MODEL, MAX OUTPUT TORQUE, MA, RATIO, GMD ERP CODE, RATE USED].
const viral = (type: string, rows: [string, string, number, string, string, string | null, number][]) =>
  rows.map(([gbCode, model, maxOutputTorque, ma, ratio, erpCode, price]) => ({ gbCode, make: 'Viral', model, maxOutputTorque, ma, ratio, erpCode, price, type }))
export const VIRAL = [
  ...viral('Worm (part-turn)', [
    ['GB-VI-VWE07', 'VWE-07', 800, '14', '40:1', null, 4200], ['GB-VI-VWE10', 'VWE-10', 1000, '15', '42:1', 'RED070005', 4800],
    ['GB-VI-VWE15', 'VWE-15', 1500, '16', '42:1', 'RET010002', 6400], ['GB-VI-VWE20', 'VWE-20', 2000, '20', '52:1', 'RL1030007', 7500],
    ['GB-VI-VWE30', 'VWE-30', 3000, '20', '52:1', 'RET010015', 9500], ['GB-VI-VWE40', 'VWE-40', 4000, '21', '55:1', 'RL1030004', 13600],
    ['GB-VI-VWESGA40', 'VWESGA-40', 4000, '54', '165:1', null, 15000], ['GB-VI-VWESGA60', 'VWESGA-60', 6000, '62', '194:1', 'RL2010004', 16000],
    ['GB-VI-VWESGA80', 'VWESGA-80', 8000, '70', '220:1', 'RL1010012', 17625], ['GB-VI-VWESGA100', 'VWESGA-100', 10000, '95', '300:1', 'RL1010024', 25380],
    ['GB-VI-VWESGA150', 'VWESGA-150', 15000, '143', '449:1', 'RL2010003', 32000], ['GB-VI-VWESGA250', 'VWESGA-250', 25000, '190', '605:1', 'RL2020001', 45000],
    ['GB-VI-VWESGA350', 'VWESGA-350', 35000, '320', '992:1', 'RL2020002', 69700], ['GB-VI-VWESGA500', 'VWESGA-500', 50000, '340', '1039:1', 'RL1010019', 107500],
    ['GB-VI-VWESGA750', 'VWESGA-750', 75000, '461', '1425:1', 'RL1010004', 149500], ['GB-VI-VWESGA1000', 'VWESGA-1000', 100000, '569', '1768:1', 'RL1030001', 181350],
    ['GB-VI-VWESGA1500', 'VWESGA-1500', 150000, '655', '2109:1', 'RL1030002', 220000], ['GB-VI-VWESGA2000', 'VWESGA-2000', 200000, '762', '2381:1', 'RL1030003', 274815],
    ['GB-VI-VWESGA2500', 'VWESGA-2500', 250000, '800', '2510:1', 'RL1010017', 380000], ['GB-VI-VWESGA3750', 'VWESGA-3750', 375000, '1051', '3332:1', 'RL1030005', 795000],
    ['GB-VI-VWESGA5000', 'VWESGA-5000', 500000, '1208', '3808:1', 'RL1030006', 945000],
  ]),
  ...viral('Spur (multi-turn)', [
    ['GB-VI-SGB300', 'SGB-300', 300, '2.6', '3:1', 'RSU010005', 5000], ['GB-VI-SGB600', 'SGB-600', 600, '3.5', '4:1', 'RSE010030', 6500],
    ['GB-VI-SGB1000', 'SGB-1000', 1000, '4.4', '5:1', 'REC030002', 9100], ['GB-VI-SGB2000', 'SGB-2000', 2000, '8.8 / 7', '10:1 / 8:1', 'RL3010001', 16500],
    ['GB-VI-SGB3000', 'SGB-3000', 3000, '8.8 / 7', '10:1 / 8:1', null, 28500], ['GB-VI-SGB5000', 'SGB-5000', 4500, '10.6 / 8.8', '12:1 / 10:1', null, 59000],
    ['GB-VI-SGB8000', 'SGB-8000', 6000, '12.3 / 10.6', '14:1 / 12:1', 'RSU010004', 76000], ['GB-VI-SGB10000', 'SGB-10000', 10000, '16.7 / 14.1', '19:1 / 16:1', 'RXX010001', 119500],
  ]),
]

// Tab "IMPORTED_VALVE_DATA (TFW)" in the live sheet's shape (23 Nov 2026): title rows, a blank row, then three blocks, each with
// its own header row. Only the cells the parser reads are filled (stem / shaft cells are blank here); numbers come as numbers or text.
const tfwA = (pn: string, rows: [number, number, number][]) => rows.map(([dn, turns, torque]) => [dn, pn, turns, torque])
const tfwC = (type: string, rows: [number, number, string][]) => rows.map(([dn, sf, flange]) => [dn, type, 'PN16', null, null, 'Square', null, flange, 1.2, sf])
const TFW_BFV: [number, number, string][] = [
  [50, 28.8, 'F05'], [65, 38.4, 'F05'], [80, 51.6, 'F05'], [100, 86.4, 'F07'], [125, 129.6, 'F07'], [150, 208.8, 'F07'], [200, 396, 'F10'],
  [250, 658.8, 'F10'], [300, 958.8, 'F10'], [350, 1162.8, 'F10'], [400, 1568.4, 'F14'], [450, 2144.4, 'F14'], [500, 2745.6, 'F14'], [600, 4453.2, 'F16'],
]
export const TFW_ROWS: unknown[][] = [
  ['IMPORTED VALVE DATA – Tianjin Tangfa (TFW)'],
  ['Imported valves use this torque (with safety factor) and these turns; Indian valves stay on VALVE_TORQUE / MAPPING.'],
  [],
  ['DN', 'PN', 'TURNS TO OPEN', 'TORQUE WITH SF (Nm)', 'TORQUE W/O SF (Nm)', 'TOP FLANGE PCD / HOLES (≥DN600)', 'STEM DIA (mm, ≥DN600)', 'TFW GB OUTPUT TORQUE (Nm)', 'STEM TOP (square) – PN16', 'STEM TOP (square) – PN25', 'REMARK'],
  ...tfwA('PN16 (also used for PN10)', [
    [40, 10, 60], [50, 13, 60], [80, 20, 75], [100, 25, 100], [150, 37.5, 150], [200, 34, 200], [250, 42, 250], [300, 50, 300], [350, 30, 325],
    [400, 34, 350], [450, 38, 425], [500, 42, 525], [600, 50, 800], [700, 59, 930], [800, 67, 1000], [900, 75, 1100], [1200, 75, 3400],
  ]),
  ...tfwA('PN25', [[40, 10, 90], [50, 13, 90], [80, 20, 110], [100, 25, 150], [150, 30, 225], [200, 40, 300], [250, 42, 375], [300, 50, 450]]),
  ['350', 'PN25', '60', '490'], // text cells, as UNFORMATTED_VALUE gives a cell typed as text
  [500, 'PN25', 42, 790],
  [1000, 'PN16', 75, 1867, '—'],
  [],
  ['B. GATE VALVE DN600+ WITH TFW GEARBOX – shaft, bracket & gearbox'],
  ['DN', 'PN', 'SHAFT DIA (mm)', 'SHAFT LENGTH (mm)', 'SHAFT SHAPE', 'KEY', 'VALVE TORQUE (Nm)', 'BRACKET / FLANGE', 'SAFETY FACTOR', 'GB TORQUE (Nm)', 'TFW GB RATIO'],
  ...([[600, 'PN16', 'F16'], [700, 'PN16', 'F25'], [800, 'PN16', 'F25'], [900, 'PN16', 'F25'], [600, 'PN25', 'F16'], [700, 'PN25', 'F25'], [800, 'PN25', 'F25']] as const)
    .map(([dn, pn, flange]) => [dn, pn, null, null, null, null, 9999, flange]), // 9999: this block's torque is never used
  [],
  ['C. BUTTERFLY VALVE (TFW) – shaft & top flange'],
  ['DN', 'TYPE', 'PN', 'SHAFT (square, mm)', 'SHAFT LENGTH (mm)', 'SHAFT SHAPE', 'TORQUE (Nm)', 'TOP FLANGE (ISO 5211)', 'SAFETY FACTOR', 'TORQUE WITH SF (Nm)', 'REMARK'],
  ...tfwC('DOUBLE FLANGED', TFW_BFV),
  ...tfwC('WAFER', TFW_BFV.filter(([dn]) => dn <= 300)),
]

const map = (mapKey: string, requiredTorque: number, valveFlange: string, gearbox = '— (direct)') => ({ mapKey, requiredTorque, gearbox, valveFlange })
export const MASTER: Master = {
  mappings: [
    map('BFV|100|PN10', 60, 'F07', 'GS 50.2'), map('BFV|500|PN16', 6198, 'F25', 'GS 125.2 + VZ4'), map('BFV|700|PN16', 14287, 'F25', 'GS 200 + GZ16'),
    map('BFV|800|PN10', 21037, 'F25', 'GS 200 + GZ16'), map('BFV|900|PN10', 28215, 'F25', 'GS 250 + GZ25'),
    map('BFV|1300|PN16', 85030, 'F35', 'Special – refer OEM'),
    map('SLUICE|80|PN10', 52, 'F10'), map('SLUICE|150|PN16', 130, 'F10'), map('SLUICE|300|PN10', 325, 'F14'), map('SLUICE|350|PN16', 569, 'F16'),
    map('SLUICE|500|PN10', 975, 'F25'), map('SLUICE|700|PN10', 1950, 'F25'), map('SLUICE|1200|PN10', 6240, 'F35'),
    map('SLUICE-RS|600|PN10', 456, 'F16'), map('KGV|50|PN10', 39, 'F10'),
  ],
  actuators: [
    { actCode: 'ACT-AU-SA3', make: 'AUMA', series: SA, model: 'SA 3', maxTorque: 30, price: 54900 },
    { actCode: 'ACT-AU-SA6', make: 'AUMA', series: SA, model: 'SA 6', maxTorque: 60, price: 54900 },
    { actCode: 'ACT-AU-SA12', make: 'AUMA', series: SA, model: 'SA 12', maxTorque: 120, price: 56500 },
    { actCode: 'ACT-AU-SA15', make: 'AUMA', series: SA, model: 'SA 15', maxTorque: 150, price: 57500 },
    { actCode: 'ACT-AU-SA25', make: 'AUMA', series: SA, model: 'SA 25', maxTorque: 250, price: 67000 },
    { actCode: 'ACT-AU-SA30', make: 'AUMA', series: SA, model: 'SA 30', maxTorque: 300, price: 70000 },
    { actCode: 'ACT-AU-SA50', make: 'AUMA', series: SA, model: 'SA 50', maxTorque: 500, price: 94400 },
    { actCode: 'ACT-AU-SA60', make: 'AUMA', series: SA, model: 'SA 60', maxTorque: 600, price: 104900 },
    { actCode: 'ACT-AU-SA100', make: 'AUMA', series: SA, model: 'SA 100', maxTorque: 1000, price: 141500 },
    { actCode: 'ACT-AU-SPARE', make: 'AUMA', series: SA, model: '— spare row —', maxTorque: 1000, price: null },
    { actCode: 'ACT-AU-SQ05.2', make: 'AUMA', series: 'SQ', model: 'SQ 05.2', maxTorque: 150, price: null },
    { actCode: 'ACT-RT-IQ35', make: 'Rotork', series: 'IQ3', model: 'IQ35', maxTorque: 1085, price: 227694 },
    { actCode: 'ACT-RT-K30', make: 'Rotork', series: K, model: 'K30', maxTorque: 34, price: 53664 },
    { actCode: 'ACT-RT-K60', make: 'Rotork', series: K, model: 'K60', maxTorque: 61, price: 56901 },
    { actCode: 'ACT-RT-K150', make: 'Rotork', series: K, model: 'K150', maxTorque: 152, price: 57912 },
    { actCode: 'ACT-RT-K300', make: 'Rotork', series: K, model: 'K300', maxTorque: 305, price: 74461 },
    { actCode: 'ACT-RT-K600', make: 'Rotork', series: K, model: 'K600', maxTorque: 610, price: 89849 },
  ],
  gearboxes: [{ gbCode: 'GB-AU-125.2', make: 'AUMA', model: 'GS 125.2 + VZ4', maxOutputTorque: 8000, price: 25805 }],
  viralGearboxes: VIRAL,
  gearboxStock: [
    { erpCode: 'RED070005', gbType: 'WORM', ratedTorque: 1000 }, { erpCode: 'RL1010012', gbType: 'WORM', ratedTorque: 8000 },
    { erpCode: 'REC030023', gbType: 'WORM', ratedTorque: 250 }, { erpCode: 'RET010027', gbType: 'WORM', ratedTorque: null },
    { erpCode: 'RSE010030', gbType: 'SPUR', ratedTorque: 500 }, { erpCode: '(no ERP code)', gbType: 'BEVEL', ratedTorque: null },
  ],
  actuatorStock: [
    { erpCode: 'RCB040006', ratingCode: 'K30/RPM24', make: 'Rotork', torque: 34, outputRpm: 24, actCode: 'ACT-RT-K30' },
    { erpCode: 'RCB040002', ratingCode: 'K150/RPM24', make: 'Rotork', torque: 152, outputRpm: 24, actCode: 'ACT-RT-K150' },
    { erpCode: 'RCB040004', ratingCode: 'K150/RPM48', make: 'Rotork', torque: 152, outputRpm: 48, actCode: 'ACT-RT-K150' },
    { erpCode: 'RCD020024', ratingCode: 'K300/RPM48', make: 'Rotork', torque: 305, outputRpm: 48, actCode: 'ACT-RT-K300' },
    { erpCode: 'RCB020011', ratingCode: 'SA15E63-RPM63', make: 'AUMA', torque: 150, outputRpm: 63, actCode: null },
  ],
  stockAutoPick: [], // every STOCK_ACT line says "OLD WD… – not interchangeable; auto-pick OFF" on 20 Nov
  aumaSpeeds: AUMA_SPEEDS,
  rotorkDerates: ROTORK_DERATES,
  rmCodes: RM_CODES,
  imported: parseImported(TFW_ROWS),
}

/** Free qty (live Physical Stock minus allocations): gearbox lines as GMD_GB_STOCK showed them on 20 Nov, a few actuator lines. */
export const FREE = new Map([
  ['RED070005', 51], ['RET010002', 10], ['RL1030007', 50], ['RET010015', 15], ['RL1030004', 33], ['RL2010004', 14], ['RL1010012', 32],
  ['RL1010024', 14], ['RL2010003', 27], ['RL2020001', 14], ['RL2020002', 12], ['RL1010019', 3], ['RL1030001', 7], ['RL1030002', 12],
  ['RSE010030', 15], ['REC030002', 8], ['RSU010004', 9], ['REC030023', 8],
  ['RCB040006', 4], ['RCB040002', 70], ['RCB040004', 69], ['RCD020024', 52], ['RCB020011', 6],
])
