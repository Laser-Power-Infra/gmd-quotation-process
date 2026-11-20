import "server-only";
import { Prisma, prisma } from "@gmd/db-quotation";
import { BLANK, type TableQuery, type TableSort } from "@gmd/ui/components/data-table/types";
import { PENDING_COLUMNS, type AiCheck, type PendingDocketRow, type PendingDocketsPage, type PendingScope, type PendingThread } from "../columns";
import { attachmentsOf, parseThreadMessages, repliedByLaserEntry, requestSnippet } from "./thread";

// Pending Dockets in SQL: paged, filtered, faceted and counted on the server. The host's rules pick the
// threads (ids + AI check); `l` derives one column per key in ../columns from each of them, so filters,
// facets and sorts address columns by key, and only those keys ever reach the SQL. No auth here: the
// host's actions own it.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

/** Mail from one of our own addresses is a Team request; any other sender is a Client. */
const TEAM_SENDER =
  "@gmdalui[.]co[.]in|@laserpowerinfra[.]com|laserentry|lasertender|enquiry5[.]laserpowerinfra@gmail[.]com|tech[.]laserpower@gmail[.]com";
/** GeM bid no (GEM/2026/B/123), "gem 12345" / "bidding 12345", or "TID 123" in the subject. */
const TENDER_REF =
  "(?i)(GEM[-/_ ][0-9]{4}[-/_ ][A-Z][-/_ ][0-9]+|[[:<:]](?:gem|bidding)[-_ ]*[0-9]{5,}[[:>:]]|TID[[:space:]]*[:#-]?[[:space:]]*[0-9]+)";
const EMAIL = "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}";
/** An attachment name that is neither blank nor a "[No Attachments]"-style placeholder. */
const REAL_FILE = "^[[:space:]]*[^[:space:][]";

/** One row per pending thread, columns named by the keys in ../columns; filterable text is never NULL. */
function lines(scope: PendingScope): Prisma.Sql {
  const ids = scope.rows.map((r) => r.id);
  const ai = scope.rows.map((r) => r.ai);
  return sql`SELECT t.id, t.date,
      coalesce(nullif(who.name, ''), nullif(who.email, ''), 'Unknown') AS "requester", who.email AS "email",
      CASE WHEN lower(coalesce(t.sender, '')) ~ ${TEAM_SENDER} THEN 'Team' ELSE 'Client' END AS "senderType",
      coalesce(nullif(t.subject, ''), 'No Subject') AS "subject",
      coalesce(substring(t.subject from ${TENDER_REF}), '') AS "tenderRef",
      coalesce(nullif(t.mail_type, ''), 'DOCKET') AS "mailType",
      greatest(t.msg_count, 1) AS "msgCount",
      CASE WHEN att.names = '' THEN 'No' ELSE 'Yes' END AS "files",
      s.ai AS "aiCheck",
      att.names AS "fileNames",
      left(coalesce(t.body, ''), 1000) || ' ' || left(coalesce(t.body_preview, ''), 1000) AS "mailText",
      t.ai_validation_attempts AS "aiAttempts", t.ai_validation_last_error AS "aiLastError",
      t.body, t.body_preview AS "bodyPreview", t.attach_names AS "attachNames", t.attach_links AS "attachLinks"
    FROM unnest(${ids}::int[], ${ai}::text[]) AS s(id, ai)
    JOIN docket_quotation_threads t ON t.id = s.id
    CROSS JOIN LATERAL (SELECT btrim(coalesce(t.sender, '')) AS raw) snd
    CROSS JOIN LATERAL (SELECT btrim(replace(coalesce(substring(snd.raw from '^([^<]+)'), ''), '"', '')) AS name,
      coalesce(nullif(btrim(substring(snd.raw from '^[^<]*<([^>]+)>')), ''), substring(snd.raw from ${EMAIL}), '') AS email) who
    CROSS JOIN LATERAL (SELECT coalesce(string_agg(btrim(e #>> '{}'), ' '), '') AS names
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.attach_names) = 'array' THEN t.attach_names END) e
      WHERE jsonb_typeof(e) = 'string' AND (e #>> '{}') ~ ${REAL_FILE}) att`;
}

/** What the search box looks in: the text columns plus file names and the start of the mail. */
const SEARCHED = ["requester", "email", "subject", "tenderRef", "fileNames", "mailText"];
const FILTERABLE = new Map(PENDING_COLUMNS.filter((c) => c.filter).map((c) => [c.key, c.kind]));
const FALLBACK = sql`f."date" DESC NULLS LAST, f.id DESC`;

/** Quoted column of `l`; only ever called with keys from ../columns. */
const lcol = (key: string) => Prisma.raw(`l."${key}"`);
const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const squish = (v: string) => v.replace(/\s+/g, "");
const contains = (expr: Prisma.Sql, value: string) =>
  sql`regexp_replace(${expr}, '[[:space:]]', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`;

/** WHERE over `l`; `skip` drops one key's own filter so its facet keeps every option. */
export function buildWhere(query: TableQuery, skip?: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const text = (key: string) => key !== skip && FILTERABLE.get(key) === "text";
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    if (!values?.length || !text(key)) continue;
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${lcol(key)} = ''` : sql`${lcol(key)} = ${v}`)), " OR ")})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    if (value.trim() && text(key)) parts.push(contains(lcol(key), value));
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    if (key === skip || FILTERABLE.get(key) !== "date") continue;
    // Mails are dated in IST, so a day filter is an IST calendar day.
    const day = sql`(${lcol(key)} AT TIME ZONE 'Asia/Kolkata')::date`;
    if (range.from) parts.push(sql`${day} >= ${range.from}::date`);
    if (range.to) parts.push(sql`${day} <= ${range.to}::date`);
  }
  const search = (query.search ?? "").trim();
  if (search) parts.push(contains(Prisma.join(SEARCHED.map(lcol), " || ' ' || "), search));
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

/** Newest first unless a sortable column is picked; that column then leads and newest-first breaks ties. */
export function buildOrderBy(sort: TableSort | null): Prisma.Sql {
  const column = sort && PENDING_COLUMNS.find((c) => c.key === sort.key && c.sortable);
  if (!sort || !column) return FALLBACK;
  const c = Prisma.raw(`f."${column.key}"`);
  if (column.kind === "text") return sql`NULLIF(lower(${c}), '') ${Prisma.raw(sort.dir === "asc" ? "ASC NULLS LAST" : "DESC NULLS FIRST")}, ${FALLBACK}`;
  return sql`${c} ${Prisma.raw(sort.dir === "asc" ? "ASC" : "DESC")} NULLS LAST, ${FALLBACK}`;
}

/** The statements behind one page: its rows, and the count + KPI tiles of every request the filters keep. */
export function pageSql(scope: PendingScope, query: TableQuery) {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize) || 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (Math.floor(query.page) || 1) - 1) * pageSize;
  const f = sql`WITH l AS (${lines(scope)}), f AS (SELECT * FROM l WHERE ${buildWhere(query)})`;
  return {
    rows: sql`${f} SELECT * FROM f ORDER BY ${buildOrderBy(query.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
    kpi: sql`${f} SELECT count(*)::int AS total,
      (count(*) FILTER (WHERE "aiCheck" = 'Not verified'))::int AS "notVerified",
      (count(*) FILTER (WHERE "aiCheck" = 'Verifying'))::int AS "verifying",
      (count(*) FILTER (WHERE "files" = 'Yes'))::int AS "withFiles"
      FROM f`,
  };
}

type RawRow = Omit<PendingDocketRow, "id" | "date" | "aiNote" | "snippet" | "attachments"> & {
  id: number;
  date: Date | null;
  aiAttempts: number;
  aiLastError: string | null;
  body: string | null;
  bodyPreview: string | null;
  attachNames: unknown;
  attachLinks: unknown;
};

/** Attempts while the verdict is coming; otherwise why the request is Not verified. */
export function aiNote(scope: Pick<PendingScope, "aiEnabled" | "aiMaxAttempts">, r: { aiCheck: AiCheck; aiAttempts: number; aiLastError: string | null }): string | null {
  if (r.aiCheck === "Verified") return null;
  if (r.aiCheck === "Verifying") return `${r.aiAttempts}/${scope.aiMaxAttempts}`;
  if (r.aiLastError) return r.aiLastError;
  if (!scope.aiEnabled) return "AI verification is turned off (no DOCKET_AI_API_KEY).";
  return r.aiAttempts >= scope.aiMaxAttempts
    ? `AI verification failed after ${scope.aiMaxAttempts} attempts`
    : "Not sent to AI: the mail does not match the docket-request rules";
}

export async function listPendingDocketsPage(scope: PendingScope, query: TableQuery): Promise<PendingDocketsPage> {
  const q = pageSql(scope, query);
  const [rows, [kpi]] = await Promise.all([
    prisma.$queryRaw<RawRow[]>(q.rows),
    prisma.$queryRaw<{ total: number; notVerified: number; verifying: number; withFiles: number }[]>(q.kpi),
  ]);
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      date: r.date ? r.date.toISOString() : null,
      requester: r.requester,
      email: r.email,
      senderType: r.senderType,
      subject: r.subject,
      tenderRef: r.tenderRef,
      mailType: r.mailType,
      msgCount: Number(r.msgCount),
      files: r.files,
      aiCheck: r.aiCheck,
      aiNote: aiNote(scope, r),
      snippet: requestSnippet(r.body, r.bodyPreview),
      attachments: attachmentsOf(r.attachNames, r.attachLinks),
    })),
    total: kpi.total,
    meta: {
      kpi: { notVerified: kpi.notVerified, verifying: kpi.verifying, withFiles: kpi.withFiles },
      all: scope.rows.length,
      aiPending: scope.rows.filter((r) => r.ai === "Verifying").length,
      aiEnabled: scope.aiEnabled,
    },
  };
}

/** Distinct values of a text column under every other active filter; empty cells come first as BLANK. */
export async function listPendingDocketsFacet(scope: PendingScope, key: string, query: TableQuery): Promise<string[]> {
  if (FILTERABLE.get(key) !== "text") return [];
  const rows = await prisma.$queryRaw<{ v: string }[]>`WITH l AS (${lines(scope)})
    SELECT DISTINCT ${lcol(key)} AS v FROM l WHERE ${buildWhere(query, key)} ORDER BY 1 LIMIT ${FACET_LIMIT}`;
  const values = rows.map((r) => r.v);
  return values.includes("") ? [BLANK, ...values.filter(Boolean)] : values;
}

/** The whole conversation of one thread; null when there is no such thread. */
export async function getPendingThread(id: number): Promise<PendingThread | null> {
  const t = await prisma.docketQuotationThread.findUnique({ where: { id }, select: { sender: true, body: true, bodyPreview: true } });
  if (!t) return null;
  const text = t.body || t.bodyPreview || "";
  const messages = parseThreadMessages(text);
  return {
    replied: repliedByLaserEntry(t.sender, text, messages),
    messages: messages.map((m) => ({ num: m.num, sender: m.fullSender || m.senderName, body: m.body })),
  };
}
