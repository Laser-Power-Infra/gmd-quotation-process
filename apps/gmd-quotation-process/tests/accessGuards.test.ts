import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isRestricted, requireAccess, denyIfNoAccess } from '../lib/access.js'

const APP = path.join(import.meta.dirname, '..', 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (p: string) => path.relative(APP, p).split(path.sep).join('/')

// Any of these counts as a guard (routes under scheduler/ use the API key).
const ROUTE_GUARD = /denyIfNoAccess|requireSyncApiKey|auth\(\)/
// Routes that are public on purpose.
const PUBLIC_ROUTES = new Set(['api/health/route.ts', 'api/auth/[...nextauth]/route.ts', 'api/register/route.ts', '.well-known/vercel/flags/route.ts'])

test('every API route has an access guard', () => {
  const missing = walk(APP)
    .filter((f) => f.endsWith('route.ts') && !PUBLIC_ROUTES.has(rel(f)))
    .filter((f) => !ROUTE_GUARD.test(fs.readFileSync(f, 'utf8')))
    .map(rel)
  assert.deepEqual(missing, [])
})

test('every server action calls requireAccess (or its own admin check)', () => {
  const missing = walk(APP)
    .filter((f) => /\.tsx?$/.test(f) && /^["']use server["']/.test(fs.readFileSync(f, 'utf8')))
    .filter((f) => {
      const s = fs.readFileSync(f, 'utf8')
      if (/requireAdminOrDeveloper|auth\(\)/.test(s)) return false
      const actions = (s.match(/^export async function /gm) ?? []).length
      const guards = (s.match(/await requireAccess\(\)/g) ?? []).length
      return guards < actions
    })
    .map(rel)
  assert.deepEqual(missing, [])
})

// Dashboard edits need a login even on the open (non-Vercel) server.
const DASHBOARD_EDITS: Record<string, string[]> = {
  'actions/item.ts': ['updateItemFieldAction', 'selectBomIdAction', 'fetchErpItemCodesAction', 'updateProductCostFromBomAction', 'update2to1CostAction', 'updateAllBomCostsAction', 'syncDirectM2MAvailableStockAction', 'importExcelDataAction', 'applyAutoFillAction', 'updateVaPercentAction'],
  'actions/enquiry.ts': ['createNewEnquiryAction', 'addItemsAction', 'updateEnquiryItemAction', 'addAttachmentsAction', 'deleteEnquiryItemAction', 'deleteEnquiryAction', 'updateEnquiryFieldAction', 'sendDocketEmailAction', 'syncEnquiryEmailAddressesAction'],
  'actions/misc.ts': ['fetchContractReviewRatesAction', 'populatePdCostValidationAction', 'clearQuotedRatesAction', 'bulkUpdateApmAction', 'bulkUpdateValidationAction'],
}

test('every dashboard edit action checks loginRequired', () => {
  const missing: string[] = []
  for (const [file, names] of Object.entries(DASHBOARD_EDITS)) {
    const src = fs.readFileSync(path.join(APP, file), 'utf8')
    for (const name of names) {
      const start = src.indexOf(`export async function ${name}(`)
      const next = src.indexOf('\nexport ', start + 1)
      const body = src.slice(start, next < 0 ? undefined : next)
      if (start < 0 || !/if \(denied\) return denied;/.test(body) || !body.includes('await loginRequired()')) missing.push(`${file}:${name}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('open deployment lets everyone through; restricted one refuses an anonymous caller', async () => {
  const saved = process.env.VERCEL
  try {
    delete process.env.VERCEL
    assert.equal(isRestricted(), false)
    await requireAccess()
    assert.equal(await denyIfNoAccess(), null)

    process.env.VERCEL = '1'
    assert.equal(isRestricted(), true)
    const res = await denyIfNoAccess()
    assert.equal(res?.status, 401)
  } finally {
    if (saved === undefined) delete process.env.VERCEL
    else process.env.VERCEL = saved
  }
})
