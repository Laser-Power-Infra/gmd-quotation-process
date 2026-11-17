import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK, type TableSort } from "@gmd/ui/components/data-table/types";
import { DEBTOR_COLUMNS } from "../columns";
import { BUCKET_KEYS, BUCKETS, type DebtorPageData, type DebtorPartyRow, type DebtorQuery, type DebtorSummary } from "../types";

// The debtor ledger rolled up per party in SQL (ageing, MSME interest and stage,
// BG exposure, follow-up, legal case), then filtered, sorted and paged, so the
// client never holds more than a page. Mirrors lib/debtorsAgeing.ts, lib/msme.ts
// and lib/legalStatus.ts of the quotation app; test/query.test.ts pins the SQL.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

/** What the SQL needs besides the query: today's local date and the MSME settings. */
export interface DebtorContext {
  today: string; // yyyy-mm-dd, local
  weekStart: string; // Monday of today's week, yyyy-mm-dd
  bankRatePct: number;
  creditDaysNoAgreement: number;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function contextFor(now: Date, msme: { bankRatePct: number; creditDaysNoAgreement: number }): DebtorContext {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return { today: ymd(now), weekStart: ymd(monday), bankRatePct: msme.bankRatePct, creditDaysNoAgreement: msme.creditDaysNoAgreement };
}

/** Same as lib/debtorJoins key(): collapse whitespace, trim, upper-case. */
const normName = (e: Prisma.Sql) => sql`upper(btrim(regexp_replace(coalesce(${e}, ''), '[[:space:]]+', ' ', 'g')))`;
const day = (e: Prisma.Sql) => sql`to_char(${e}, 'YYYY-MM-DD')`;

/** CTE `r`: one row per party with a non-zero balance, every DebtorPartyRow field plus promisedNum / promisedDay. */
export function partiesCte(c: DebtorContext): Prisma.Sql {
  const T = sql`${c.today}::date`;
  const between = (lo: number, hi: number) => sql`coalesce(sum(bal) FILTER (WHERE bal > 0 AND days > ${lo} AND days <= ${hi}), 0)`;
  return sql`WITH
  f AS (SELECT * FROM "LedgerFollowUp" WHERE ledger = 'debtor' AND "vrNo" = ''),
  lc AS (SELECT * FROM "PartyLegalCase" WHERE ledger = 'debtor'),
  b AS (
    SELECT d."accCode", d."accName", d."vrDate",
      (coalesce(d."unAllocDr", 0) - coalesce(d."unAllocCr", 0))::float8 AS bal,
      (${T} - coalesce(d."dueDate", d."vrDate")::date) AS days
    FROM "Debtor" d
    WHERE coalesce(d."unAllocDr", 0) <> coalesce(d."unAllocCr", 0)
  ),
  p AS (
    SELECT b."accCode", coalesce(max(b."accName"), b."accCode") AS "accName",
      coalesce(sum(bal) FILTER (WHERE bal > 0), 0) AS "totalDues",
      coalesce(sum(bal) FILTER (WHERE bal > 0 AND days > 0), 0) AS overdue,
      coalesce(sum(bal) FILTER (WHERE bal > 0 AND days > 90), 0) AS over90,
      coalesce(sum(bal) FILTER (WHERE bal > 0 AND (days IS NULL OR days <= 0)), 0) AS "bNotDue",
      ${between(0, 30)} AS "b0_30", ${between(30, 60)} AS "b31_60", ${between(60, 90)} AS "b61_90", ${between(90, 180)} AS "b91_180",
      coalesce(sum(bal) FILTER (WHERE bal > 0 AND days > 180), 0) AS "b180",
      coalesce(-sum(bal) FILTER (WHERE bal < 0), 0) AS credits
    FROM b GROUP BY b."accCode"
  ),
  mb AS (
    SELECT b."accCode", b.bal, (${T} - x.due) AS days,
      greatest(0, (extract(year FROM ${T}) - extract(year FROM x.due)) * 12 + extract(month FROM ${T}) - extract(month FROM x.due)
        - CASE WHEN extract(day FROM ${T}) < extract(day FROM x.due) THEN 1 ELSE 0 END)::float8 AS months
    FROM b LEFT JOIN f ON f."accCode" = b."accCode"
    CROSS JOIN LATERAL (SELECT (b."vrDate" + least(coalesce(f."creditDays", ${c.creditDaysNoAgreement}::int), 45) * interval '1 day')::date AS due) x
    WHERE b.bal > 0 AND b."vrDate" IS NOT NULL
  ),
  m AS (
    SELECT "accCode", max(days) AS days, sum(bal) AS principal,
      sum(CASE WHEN days > 0 THEN bal * (power(1 + 3 * ${c.bankRatePct}::float8 / 100 / 12, months) - 1) ELSE 0 END) AS interest
    FROM mb GROUP BY 1
  ),
  bg AS (
    SELECT ${normName(sql`"beneficiaryName"`)} AS k, sum(coalesce("bgAmt", 0))::float8 AS amt
    FROM "BankGuarantee" WHERE ${normName(sql`"cancelledStatus"`)} !~ 'CLOSED|CANCEL'
    GROUP BY 1
  ),
  r AS (
    SELECT p.*, p."totalDues" - p.credits AS net, coalesce(bg.amt, 0) AS bg,
      m.days AS "msmeDays", coalesce(m.interest, 0) AS "msmeInterest", coalesce(m.principal, 0) + coalesce(m.interest, 0) AS "msmeClaimable",
      CASE WHEN x.missed THEN 'Missed' WHEN f."promisedDate" IS NOT NULL OR f."promisedAmount" IS NOT NULL THEN 'Pending' END AS promise,
      CASE WHEN m.days IS NULL OR x.litigating THEN NULL WHEN x.missed THEN 3
        WHEN m.days >= 60 THEN 6 WHEN m.days >= 45 THEN 5 WHEN m.days >= 30 THEN 4 WHEN m.days >= 15 THEN 3 WHEN m.days >= 7 THEN 2 WHEN m.days >= 0 THEN 1 ELSE 0 END AS "msmeStage",
      x.litigating, x.provision, p."totalDues" - x.provision AS carried,
      f.owner, f."contactName", f."contactPhone", f."contactEmail", ${day(sql`f."lastFollowUp"`)} AS "lastFollowUp",
      ${day(sql`f."promisedDate"`)} AS "promisedDate", f."promisedAmount"::text AS "promisedAmount", f.status, f.remarks,
      f."creditDays"::text AS "creditDays", f."clientType", f."udyamOnInvoice", ${day(sql`f."nextActionDate"`)} AS "nextActionDate",
      f."samadhaanNo", f."samadhaanStatus",
      lc.status AS "legalStatus", lc.forum, lc."caseNo", ${day(sql`lc."filingDate"`)} AS "filingDate", ${day(sql`lc."nextHearingDate"`)} AS "nextHearingDate",
      lc.advocate, lc."claimAmount"::text AS "claimAmount", lc."interestClaimed"::text AS "interestClaimed", lc."provisionPct"::text AS "provisionPct",
      lc."provisionAmount"::text AS "provisionAmount", lc."documentLink", lc."lastUpdate",
      f."promisedAmount"::float8 AS "promisedNum", f."promisedDate"::date AS "promisedDay"
    FROM p
    LEFT JOIN f ON f."accCode" = p."accCode"
    LEFT JOIN lc ON lc."accCode" = p."accCode"
    LEFT JOIN m ON m."accCode" = p."accCode"
    LEFT JOIN bg ON bg.k = ${normName(sql`p."accName"`)}
    CROSS JOIN LATERAL (SELECT
      (lc.status IS NOT NULL AND lc.status NOT IN ('', 'None', 'Closed')) AS litigating,
      coalesce(f."promisedDate"::date < ${T} AND p.overdue > 0, false) AS missed,
      CASE WHEN lc.id IS NULL OR p."totalDues" <= 0 THEN 0
        ELSE least(greatest(coalesce(lc."provisionAmount"::float8, p."totalDues" * lc."provisionPct" / 100, 0), 0), p."totalDues") END AS provision
    ) x
  )`;
}

const COLUMN = new Map(DEBTOR_COLUMNS.map((c) => [c.key, c]));
const col = (key: string) => Prisma.raw(`r."${key}"`);
const text = (key: string) => sql`btrim(coalesce(${col(key)}::text, ''))`;
const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "").toLowerCase();

/** WHERE over `r` for `query`; `skip` drops one column's own filter so its facet keeps every option. */
export function buildWhere(query: DebtorQuery, c: DebtorContext, skip?: string): Prisma.Sql {
  const extra = query.extra ?? {};
  // Parties under litigation leave the collection views (and every reminder-style filter) and get their own view.
  const parts: Prisma.Sql[] = [extra.view === "litigation" ? sql`r.litigating` : sql`NOT r.litigating`];
  for (const [key, values] of Object.entries(query.filters)) {
    if (key === skip || !values?.length || !COLUMN.get(key)?.filter) continue;
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${text(key)} = ''` : sql`${text(key)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (key === skip || !value.trim() || !COLUMN.has(key)) continue;
    parts.push(sql`regexp_replace(lower(${text(key)}), '[[:space:]]', '', 'g') LIKE ${`%${escapeLike(squish(value))}%`}`);
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (key === skip || COLUMN.get(key)?.kind !== "date") continue;
    // yyyy-mm-dd text compares in date order
    if (range.from) parts.push(sql`${col(key)} >= ${range.from}`);
    if (range.to) parts.push(sql`${col(key)} <= ${range.to}`);
  }
  const search = squish(query.search);
  if (search) parts.push(sql`regexp_replace(lower(r."accName" || ' ' || r."accCode"), '[[:space:]]', '', 'g') LIKE ${`%${escapeLike(search)}%`}`);
  const T = sql`${c.today}::date`;
  switch (extra.view) {
    case "today":
      parts.push(sql`(r."nextActionDate" <= ${c.today} OR (r."promisedDay" < ${T} AND r.overdue > 0))`);
      break;
    case "breach":
      parts.push(sql`r."msmeDays" > 0`);
      break;
    case "overdue":
      parts.push(sql`r.overdue > 0`);
      break;
    case "over45":
      // shortcut: "past 45 days" is approximated by the 61+ buckets, upgrade with the 45-day bucket cut
      parts.push(sql`r."b61_90" + r."b91_180" + r."b180" > 0`);
      break;
    case "broken":
      parts.push(sql`(r."promisedDay" < ${T} AND r.overdue > 0)`);
      break;
  }
  if (extra.bucket && BUCKETS.includes(extra.bucket)) parts.push(sql`${col(BUCKET_KEYS[extra.bucket])} > 0`);
  if (extra.weekOnly) parts.push(sql`(r."promisedDay" >= ${c.weekStart}::date AND r."promisedDay" < ${c.weekStart}::date + 7)`);
  return Prisma.join(parts, " AND ");
}

const FALLBACK_ORDER = sql`r.overdue DESC, r."totalDues" DESC, r."accCode" ASC`;

export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && COLUMN.get(sort.key);
  if (!sort || !column?.sortable) return FALLBACK_ORDER;
  const dir = Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC");
  if (column.kind === "number") {
    // follow-up / legal amounts are stored text in r; computed ones are numbers already
    const e = column.edit ? sql`NULLIF(${text(sort.key)}, '')::numeric` : col(sort.key);
    return sql`${e} ${dir} NULLS LAST, ${FALLBACK_ORDER}`;
  }
  const nulls = Prisma.raw(sort.dir === "asc" ? "NULLS LAST" : "NULLS FIRST");
  return sql`NULLIF(lower(${text(sort.key)}), '') ${dir} ${nulls}, ${FALLBACK_ORDER}`;
}

type RawRow = DebtorPartyRow & { promisedNum: number | null; promisedDay: Date | null };

export function pageSql(query: DebtorQuery, c: DebtorContext) {
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const offset = Math.max(0, query.page - 1) * pageSize;
  const where = buildWhere(query, c);
  const cte = partiesCte(c);
  return {
    rows: sql`${cte} SELECT r.* FROM r WHERE ${where} ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    agg: sql`${cte} SELECT count(*)::int AS total, coalesce(sum("totalDues"), 0) AS "totalDues", coalesce(sum(overdue), 0) AS overdue,
      coalesce(sum(net), 0) AS net, coalesce(sum(bg), 0) AS bg FROM r WHERE ${where}`,
  };
}

export async function listDebtorPage(query: DebtorQuery, c: DebtorContext): Promise<DebtorPageData> {
  const q = pageSql(query, c);
  const [rows, [agg]] = await Promise.all([
    prisma.$queryRaw<RawRow[]>(q.rows),
    prisma.$queryRaw<{ total: number; totalDues: number; overdue: number; net: number; bg: number }[]>(q.agg),
  ]);
  return {
    rows: rows.map(({ promisedNum: _n, promisedDay: _d, ...row }) => row),
    total: agg.total,
    meta: { totals: { totalDues: agg.totalDues, overdue: agg.overdue, net: agg.net, bg: agg.bg } },
  };
}

/** Distinct values of `key` under every other active filter; empty cells come first as BLANK. */
export async function listDebtorFacet(key: string, query: DebtorQuery, c: DebtorContext): Promise<string[]> {
  if (!COLUMN.get(key)?.filter) return [];
  const isNumber = COLUMN.get(key)?.kind === "number";
  const rows = await prisma.$queryRaw<{ v: string }[]>`${partiesCte(c)} SELECT DISTINCT ${text(key)} AS v
    FROM r WHERE ${buildWhere(query, c, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  if (isNumber) values.sort((a, b) => Number(a) - Number(b));
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}

/** Sidebar figures over the whole ledger (filters do not apply), as before the move to SQL. */
export async function getDebtorSummary(c: DebtorContext): Promise<DebtorSummary> {
  const cte = partiesCte(c);
  const inWeek = sql`r."promisedDay" >= ${c.weekStart}::date AND r."promisedDay" < ${c.weekStart}::date + 7`;
  const [[s], stages, top10] = await Promise.all([
    prisma.$queryRaw<Record<string, number | Date | null>[]>`${cte} SELECT
      (SELECT count(*)::int FROM "Debtor") AS "ledgerRows", (SELECT max("syncedAt") FROM "Debtor") AS "syncedAt",
      coalesce(sum("totalDues"), 0) AS "totalDues", coalesce(sum(overdue), 0) AS overdue, coalesce(sum(over90), 0) AS over90,
      coalesce(sum(credits), 0) AS credits, (count(*) FILTER (WHERE "totalDues" > 0))::int AS parties,
      ${Prisma.join(BUCKETS.map((b) => sql`coalesce(sum(${col(BUCKET_KEYS[b])}), 0) AS ${Prisma.raw(`"${BUCKET_KEYS[b]}"`)}`), ", ")},
      (count(*) FILTER (WHERE NOT litigating AND ${inWeek}))::int AS "promisedCount",
      coalesce(sum("promisedNum") FILTER (WHERE NOT litigating AND ${inWeek}), 0) AS "promisedTotal",
      coalesce(sum(provision), 0) AS provision, coalesce(sum(carried) FILTER (WHERE litigating), 0) AS "underLitigation"
      FROM r`,
    prisma.$queryRaw<{ stage: number; count: number; value: number }[]>`${cte} SELECT "msmeStage" AS stage, count(*)::int AS count, sum("totalDues") AS value
      FROM r WHERE "msmeStage" IS NOT NULL AND "totalDues" > 0 GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ accCode: string; accName: string; overdue: number }[]>`${cte} SELECT "accCode", "accName", overdue
      FROM r WHERE NOT litigating AND overdue > 0 ORDER BY overdue DESC, "totalDues" DESC, "accCode" LIMIT 10`,
  ]);
  const n = (k: string) => Number(s[k] ?? 0);
  const gross = n("totalDues");
  return {
    ledgerRows: n("ledgerRows"),
    syncedAt: s.syncedAt instanceof Date ? s.syncedAt.toISOString() : null,
    totalDues: gross,
    overdue: n("overdue"),
    over90: n("over90"),
    credits: n("credits"),
    net: gross - n("credits"),
    parties: n("parties"),
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, n(BUCKET_KEYS[b])])) as DebtorSummary["buckets"],
    promised: { count: n("promisedCount"), total: n("promisedTotal") },
    split: { gross, underLitigation: n("underLitigation"), provision: n("provision"), netCollectable: gross - n("underLitigation") - n("provision") },
    stages,
    top10,
  };
}
