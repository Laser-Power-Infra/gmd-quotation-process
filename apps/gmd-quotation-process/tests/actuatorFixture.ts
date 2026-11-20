// Rows of the live actuator master sheet (18 Nov 2026), trimmed to the columns the actuator / gearbox pick reads.
import type { Master } from '../lib/actuatorSelect.js'

const K = 'K-series (GMD stock)'
export const MASTER: Master = {
  mappings: [
    { mapKey: 'BFV|400|PN10', requiredTorque: 2148, gearbox: 'GS 100.3', actInputTorque: 134, valveFlange: 'F16' },
    { mapKey: 'BFV|500|PN16', requiredTorque: 6198, gearbox: 'GS 125.3 + VZ', actInputTorque: 155, valveFlange: 'F25' },
    { mapKey: 'BFV|700|PN16', requiredTorque: 14287, gearbox: 'GS 160.3 + GZ', actInputTorque: 238, valveFlange: 'F25' },
    { mapKey: 'BFV|1300|PN16', requiredTorque: 85030, gearbox: 'Special – refer OEM', actInputTorque: null, valveFlange: 'F35' },
    { mapKey: 'SLUICE|80|PN10', requiredTorque: 52, gearbox: '— (direct)', actInputTorque: 52, valveFlange: 'F10' },
    { mapKey: 'SLUICE|700|PN10', requiredTorque: 1950, gearbox: '— (direct)', actInputTorque: 1950, valveFlange: 'F25' },
  ],
  actuators: [
    { actCode: 'ACT-AU-SA10.2', make: 'AUMA', series: 'SA', model: 'SA 10.2', maxTorque: 120, price: 56500 },
    { actCode: 'ACT-AU-SA14.2', make: 'AUMA', series: 'SA', model: 'SA 14.2', maxTorque: 250, price: 67000 },
    { actCode: 'ACT-AU-SA25.1', make: 'AUMA', series: 'SA', model: 'SA 25.1', maxTorque: 2000, price: null },
    { actCode: 'ACT-AU-SQ05.2', make: 'AUMA', series: 'SQ', model: 'SQ 05.2', maxTorque: 150, price: null },
    { actCode: 'ACT-RT-IQ20', make: 'Rotork', series: 'IQ3', model: 'IQ20', maxTorque: 203, price: null },
    { actCode: 'ACT-RT-K30', make: 'Rotork', series: K, model: 'K30', maxTorque: 51, price: 53664 },
    { actCode: 'ACT-RT-K60', make: 'Rotork', series: K, model: 'K60', maxTorque: 91, price: 56901 },
    { actCode: 'ACT-RT-K150', make: 'Rotork', series: K, model: 'K150', maxTorque: 228, price: 57912 },
    { actCode: 'ACT-RT-K300', make: 'Rotork', series: K, model: 'K300', maxTorque: 457, price: 74461 },
    { actCode: 'ACT-RT-K600', make: 'Rotork', series: K, model: 'K600', maxTorque: 915, price: 89849 },
  ],
  gearboxes: [{ gbCode: 'GB-AU-125.3', make: 'AUMA', model: 'GS 125.3 + VZ', maxOutputTorque: 8000, price: 25805 }],
  viralGearboxes: [
    { gbCode: 'GB-VI-VWSGA100', make: 'Viral', model: 'VWSGA100', maxOutputTorque: 10000, erpCode: 'RL1010024', type: 'Worm (part-turn)', price: 25380 },
    { gbCode: 'GB-VI-SGBE1000', make: 'Viral', model: 'SGBE-1000', maxOutputTorque: 1000, erpCode: null, type: 'Spur/bevel (multi-turn, sluice)', price: 9100 },
    { gbCode: 'GB-VI-VWE10', make: 'Viral', model: 'VWE-10', maxOutputTorque: 1000, erpCode: 'RED070005', type: 'Worm (part-turn)', price: 4800 },
    { gbCode: 'GB-VI-VWESGA80', make: 'Viral', model: 'VWESGA-80', maxOutputTorque: 8000, erpCode: 'RL1010012', type: 'Worm (part-turn)', price: 17625 },
    { gbCode: 'GB-VI-VWESGA150', make: 'Viral', model: 'VWESGA-150', maxOutputTorque: 15000, erpCode: 'RL2010003', type: 'Worm (part-turn)', price: 32000 },
    { gbCode: 'GB-VI-SGB600', make: 'Viral', model: 'SGB-600 / SGBE-600', maxOutputTorque: 600, erpCode: 'RSE010030', type: 'Spur (multi-turn)', price: 6500 },
  ],
  gearboxStock: [
    { erpCode: 'RED070005', gbType: 'WORM', ratedTorque: 1000 },
    { erpCode: 'RL1010012', gbType: 'WORM', ratedTorque: 8000 },
    { erpCode: 'RL1010024', gbType: 'WORM', ratedTorque: 10000 },
    { erpCode: 'RL2010003', gbType: 'WORM', ratedTorque: 15000 },
    { erpCode: 'RET010027', gbType: 'WORM', ratedTorque: null },
    { erpCode: 'RSE010030', gbType: 'SPUR', ratedTorque: 500 },
    { erpCode: '(no ERP code)', gbType: 'BEVEL', ratedTorque: null },
  ],
  actuatorStock: [
    { erpCode: 'RCB040006', ratingCode: 'K30/RPM24', make: 'Rotork', torque: 51, actCode: 'ACT-RT-K30' },
    { erpCode: 'RCD020026', ratingCode: 'K150/RPM24', make: 'Rotork', torque: 228, actCode: 'ACT-RT-K150' },
    { erpCode: 'RCB040002', ratingCode: 'K150/RPM24', make: 'Rotork', torque: 228, actCode: 'ACT-RT-K150' },
    { erpCode: 'RCD020024', ratingCode: 'K300/RPM48', make: 'Rotork', torque: 457, actCode: 'ACT-RT-K300' },
    { erpCode: 'RCB020011', ratingCode: 'SA15E63-RPM63', make: 'AUMA', torque: null, actCode: null },
  ],
}

/** Free qty (live Physical Stock minus allocations) as read on 18 Nov; RSE010030 left out (no free spur gearbox). */
export const FREE = new Map([
  ['RL1010012', 32], ['RL2010003', 27], ['RL1010024', 14], ['RED070005', 51],
  ['RCD020026', 29], ['RCB040002', 70], ['RCD020024', 52], ['RCB040006', 4], ['RCB020011', 6],
])
