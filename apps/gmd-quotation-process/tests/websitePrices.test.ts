import test from 'node:test'
import assert from 'node:assert/strict'

// Pure snapshot builder for the hourly website price push. No DB, no network.
test('buildCostSnapshot: trims codes, keeps null cost, drops blank codes and bad costs', async () => {
  const { buildCostSnapshot } = await import('../schedular_function/website-prices.js')

  const decimal = (v: string) => ({ toString: () => v }) // stands in for Prisma.Decimal
  const out = buildCostSnapshot([
    { erpItemCode: ' RSD120013 ', cost: decimal('12345.678000000000000000000000000000') },
    { erpItemCode: 'RSD130024', cost: null }, // not priced yet -> null, still sent
    { erpItemCode: 'RBD010030', cost: 0 }, // 0 is "not priced"; the website decides
    { erpItemCode: '   ', cost: 5 }, // blank code -> dropped
    { erpItemCode: null, cost: 5 }, // new-item proposal without a code -> dropped
    { erpItemCode: 'rsd120013', cost: 9 }, // same code after trim/case -> first wins
    { erpItemCode: 'FBC010201', cost: decimal('-4') }, // nonsense negative -> null
  ])

  assert.deepEqual(out, [
    { erpItemCode: 'RSD120013', cost: 12345.678 },
    { erpItemCode: 'RSD130024', cost: null },
    { erpItemCode: 'RBD010030', cost: 0 },
    { erpItemCode: 'FBC010201', cost: null },
  ])
})
