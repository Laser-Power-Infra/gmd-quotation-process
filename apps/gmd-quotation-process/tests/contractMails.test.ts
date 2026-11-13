import test from 'node:test'
import assert from 'node:assert/strict'

// @gmd/db-quotation and @gmd/db-tender reuse these globals when set, so no DB is touched.
const THREADS = [
  // Filed under docket 412, spelled with the short year.
  {
    id: 1, threadId: '18c0aa', docketNo: 'GMD/26-27/412', date: new Date('2026-10-02T05:00:00Z'),
    subject: 'RFQ', sender: 'buyer@party.com', actionTag: 'QUOTE', bodyPreview: 'x'.repeat(600),
    attachNames: ['MC.pdf', '[No Attachments]'], attachLinks: ['https://drive.example/mc', '[No Links]'],
  },
  // Docket 1412 only shares digits with 412.
  {
    id: 2, threadId: '18c0bb', docketNo: 'GMD/2026-27/1412', date: null,
    subject: 'Other', sender: null, actionTag: null, bodyPreview: null, attachNames: null, attachLinks: null,
  },
  // No docket; the mention query finds it.
  {
    id: 3, threadId: '18c0cc', docketNo: null, date: null,
    subject: 'PO 4500012345', sender: null, actionTag: null, bodyPreview: null, attachNames: null, attachLinks: null,
  },
  // Filed under a bare "412": any year's docket 412.
  {
    id: 4, threadId: '18c0dd', docketNo: '412', date: null,
    subject: 'Old', sender: null, actionTag: null, bodyPreview: null, attachNames: null, attachLinks: null,
  },
]

let sql: { text: string; values: unknown[] } | null = null
let fetchArgs: { where: { id: { in: number[] } }; orderBy: unknown; take: number } | null = null

const g = globalThis as unknown as { quotationPrisma: unknown; tenderPrisma: unknown }
g.tenderPrisma = {
  contractReview: {
    findMany: async ({ where }: { where: { contractNo: { equals: string } } }) => {
      const no = where.contractNo.equals.toUpperCase()
      // The sheet has lines with a blank CONTRACT NO.
      if (no.trim() === '') return [{ docketNo: 'GMD/2026-27/412', poNo: null }]
      return no === 'SD26Y-00067'
        ? [
            { docketNo: 'GMD/2026-27/500', poNo: 'PO NO. 4500012345 DT 01.02.2026' },
            { docketNo: null, poNo: null },
            // Junk in DOCKET NO.
            { docketNo: 'NA, 412', poNo: null },
          ]
        : []
    },
  },
}
g.quotationPrisma = {
  enquiry: {
    findMany: async () => [
      { docketNumber: ' GMD/2026-27/412 ', selectedContractNo: ['sd26y-00067 '] },
      { docketNumber: 'GMD/2026-27/999', selectedContractNo: ['SD26Y-00068'] },
    ],
  },
  docketQuotationThread: {
    findMany: async (args: { where: { OR?: { docketNo: { contains: string } }[]; id?: { in: number[] } } }) => {
      const { OR } = args.where
      if (OR) return THREADS.filter((t) => OR.some((o) => (t.docketNo ?? '').includes(o.docketNo.contains)))
      fetchArgs = args as typeof fetchArgs
      return THREADS.filter((t) => args.where.id!.in.includes(t.id))
    },
  },
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    sql = { text: strings.join('?'), values }
    return [{ id: 3 }]
  },
}

test('an unknown contract has no mails and searches no threads', async () => {
  const { findContractMails } = await import('../lib/contractMails.js')
  sql = null
  assert.deepEqual(await findContractMails('NOPE-1'), [])
  assert.equal(sql, null)
})

test('a blank contract no has no mails, though sheet lines with a blank CONTRACT NO exist', async () => {
  const { findContractMails } = await import('../lib/contractMails.js')
  sql = null
  for (const blank of ['', '   ']) assert.deepEqual(await findContractMails(blank), [])
  assert.equal(sql, null)
})

test("a contract's mails are its dockets' threads plus the threads that name it, newest first", async () => {
  const { findContractMails } = await import('../lib/contractMails.js')
  const mails = await findContractMails(' SD26Y-00067 ')

  // Docket 412 comes from the enquiry's Selected Contract No (any case or spacing), 500 from DOCKET NO.
  // The bare "412" in DOCKET NO is too short to be a docket, so thread 4 stays out.
  assert.deepEqual([...fetchArgs!.where.id.in].sort(), [1, 3])
  assert.deepEqual(fetchArgs!.orderBy, [{ date: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }])
  assert.equal(fetchArgs!.take, 200)

  // One pattern for every term, bound once per searched column; the terms are never part of the SQL text.
  assert.ok(sql && !sql.text.includes('SD26Y') && !sql.text.includes('4500012345'))
  const [pattern, ...rest] = sql!.values
  assert.equal(typeof pattern, 'string')
  assert.deepEqual(rest, [pattern, pattern, 200])
  const re = new RegExp(pattern as string, 'i')
  for (const term of ['SD26Y-00067', '4500012345', 'GMD/2026-27/412', 'GMD/2026-27/500']) {
    assert.ok(re.test(term), term)
  }
  // Junk dockets ("NA", a bare "412") are no search terms: they would match unrelated mails.
  assert.ok(!re.test('Rs 412 only') && !re.test('NA'))
  // Ties on date break on id, as in the final fetch, so the same 200 are kept every time.
  assert.match(sql!.text, /ORDER BY date DESC NULLS LAST, id DESC/)

  assert.deepEqual(mails.find((m) => m.threadId === '18c0aa'), {
    threadId: '18c0aa',
    subject: 'RFQ',
    sender: 'buyer@party.com',
    date: '2026-10-02T05:00:00.000Z',
    actionTag: 'QUOTE',
    bodyPreview: 'x'.repeat(500),
    attachments: [{ name: 'MC.pdf', url: 'https://drive.example/mc' }],
    gmailUrl: 'https://mail.google.com/mail/u/0/#all/18c0aa',
  })
})
