import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { PENDING_COLUMNS, type PendingScope } from "../src/columns";
import { aiNote, buildOrderBy, buildWhere, getPendingThread, listPendingDocketsFacet, listPendingDocketsPage, pageSql } from "../src/server/query";
import { attachmentsOf, parseThreadMessages, repliedByLaserEntry, requestSnippet } from "../src/server/thread";
import reducer, { clearFilters, queryOf, setFilter, setPage, setSearch } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 25, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");
const scope: PendingScope = { rows: [{ id: 7, ai: "Verified" }, { id: 9, ai: "Verifying" }], aiEnabled: true, aiMaxAttempts: 3 };

test("buildWhere: facets, blank, search; unknown and non-filter keys are ignored", () => {
  const w = buildWhere({ ...base, filters: { requester: ["Puja", BLANK], bogus: ["x"], msgCount: ["2"], snippet: ["y"] }, search: "50%_ o" });
  assert.match(flat(w), /\(l\."requester" = \? OR l\."requester" = ''\)/);
  assert.match(flat(w), /regexp_replace\(l\."requester" \|\| ' ' \|\| .*l\."subject" \|\| .*l\."mailText", '\[\[:space:\]\]', '', 'g'\) ILIKE \?/);
  assert.deepEqual(w.values, ["Puja", "%50\\%\\_o%"]);
  assert.ok(!w.sql.includes("bogus") && !w.sql.includes("msgCount") && !w.sql.includes("snippet"));
  assert.equal(buildWhere(base).sql, "TRUE");
  // A key's own facet drops its filter, so picking a value keeps the list.
  assert.equal(buildWhere({ ...base, filters: { aiCheck: ["Verifying"] } }, "aiCheck").sql, "TRUE");
});

test("buildWhere: IST day range on the date column only; column search squashes spaces", () => {
  const w = buildWhere({
    ...base,
    dateRanges: { date: { from: "2026-11-01", to: "2026-11-15" }, subject: { from: "2026-01-01", to: "" } },
    columnSearch: { subject: "pump  set", nope: "x", msgCount: "2" },
  });
  assert.match(flat(w), /regexp_replace\(l\."subject", '\[\[:space:\]\]', '', 'g'\) ILIKE \?/);
  assert.match(flat(w), /\(l\."date" AT TIME ZONE 'Asia\/Kolkata'\)::date >= \?::date AND \(l\."date" AT TIME ZONE 'Asia\/Kolkata'\)::date <= \?::date/);
  assert.deepEqual(w.values, ["%pumpset%", "2026-11-01", "2026-11-15"]);
  assert.ok(!w.sql.includes("nope") && !w.sql.includes("msgCount"));
  assert.equal(buildWhere({ ...base, dateRanges: { date: { from: "2026-11-01", to: "" } } }, "date").sql, "TRUE");
});

test("buildOrderBy: sortable columns only, text vs number vs date, newest first otherwise", () => {
  const fallback = buildOrderBy(null).sql;
  assert.equal(flat(buildOrderBy(null)), `f."date" DESC NULLS LAST, f.id DESC`);
  assert.match(flat(buildOrderBy({ key: "requester", dir: "asc" })), /^NULLIF\(lower\(f\."requester"\), ''\) ASC NULLS LAST, f\."date" DESC/);
  assert.match(flat(buildOrderBy({ key: "aiCheck", dir: "desc" })), /^NULLIF\(lower\(f\."aiCheck"\), ''\) DESC NULLS FIRST, /);
  assert.match(flat(buildOrderBy({ key: "msgCount", dir: "desc" })), /^f\."msgCount" DESC NULLS LAST, /);
  assert.match(flat(buildOrderBy({ key: "date", dir: "asc" })), /^f\."date" ASC NULLS LAST, /);
  assert.equal(buildOrderBy({ key: "snippet", dir: "asc" }).sql, fallback); // not sortable
  assert.equal(buildOrderBy({ key: 'x"; drop table t; --', dir: "asc" }).sql, fallback);
});

test("pageSql: scope goes in as two arrays, page size is capped, KPIs count the filtered set", () => {
  const q = pageSql(scope, { ...base, page: 2, pageSize: 1000, filters: { files: ["Yes"] } });
  assert.match(flat(q.rows), /FROM unnest\(\?::int\[\], \?::text\[\]\) AS s\(id, ai\) JOIN docket_quotation_threads t ON t\.id = s\.id/);
  assert.ok(q.rows.values.some((v) => JSON.stringify(v) === "[7,9]"));
  assert.ok(q.rows.values.some((v) => JSON.stringify(v) === '["Verified","Verifying"]'));
  assert.match(flat(q.rows), /f AS \(SELECT \* FROM l WHERE \(l\."files" = \?\)\)/);
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 200]);
  assert.match(flat(q.kpi), /count\(\*\)::int AS total, \(count\(\*\) FILTER \(WHERE "aiCheck" = 'Not verified'\)\)::int AS "notVerified"/);
  assert.match(flat(q.kpi), /FILTER \(WHERE "files" = 'Yes'\)\)::int AS "withFiles" FROM f$/);
  // Junk paging from the client cannot produce a negative offset or an empty page size.
  assert.deepEqual(pageSql(scope, { ...base, page: -3, pageSize: Number.NaN }).rows.values.slice(-2), [1, 0]);
});

test("every filter / sort key is a column the SQL derives; filters are text or date", () => {
  const select = flat(pageSql(scope, base).rows);
  for (const c of PENDING_COLUMNS) {
    if (c.filter) assert.ok(c.kind === "text" || c.kind === "date", c.key);
    if (c.filter || c.sortable) assert.ok(select.includes(`AS "${c.key}"`) || select.includes(`t.${c.key},`), c.key);
  }
});

test("facets: only text columns reach the database", async () => {
  assert.deepEqual(await listPendingDocketsFacet(scope, "msgCount", base), []);
  assert.deepEqual(await listPendingDocketsFacet(scope, "date", base), []);
  assert.deepEqual(await listPendingDocketsFacet(scope, "nope", base), []);
});

test("aiNote: progress while verifying, the reason when not verified", () => {
  const on = { aiEnabled: true, aiMaxAttempts: 3 };
  assert.equal(aiNote(on, { aiCheck: "Verified", aiAttempts: 1, aiLastError: null }), null);
  assert.equal(aiNote(on, { aiCheck: "Verifying", aiAttempts: 1, aiLastError: null }), "1/3");
  assert.equal(aiNote(on, { aiCheck: "Not verified", aiAttempts: 3, aiLastError: "rate limited" }), "rate limited");
  assert.equal(aiNote(on, { aiCheck: "Not verified", aiAttempts: 3, aiLastError: null }), "AI verification failed after 3 attempts");
  assert.match(aiNote(on, { aiCheck: "Not verified", aiAttempts: 0, aiLastError: null })!, /^Not sent to AI/);
  assert.match(aiNote({ ...on, aiEnabled: false }, { aiCheck: "Not verified", aiAttempts: 0, aiLastError: null })!, /turned off/);
});

const THREAD = [
  "--- Message 1 From: Puja Agarwal <puja@client.in> ---",
  "Please create docket for 4 sluice valves",
  "",
  "On Mon, 3 Nov 2026 at 10:15, someone wrote:",
  "> older text",
  "--- Message 2 From: Laser Entry <laserentry.four@gmail.com> ---",
  "Noted, will do.",
].join("\n");

test("thread text: messages, snippet, Laser Entry reply", () => {
  const messages = parseThreadMessages(THREAD);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    num: 1,
    senderName: "Puja Agarwal",
    senderEmail: "puja@client.in",
    fullSender: "Puja Agarwal <puja@client.in>",
    body: "Please create docket for 4 sluice valves",
  });
  assert.equal(requestSnippet(THREAD, "preview"), "Please create docket for 4 sluice valves");
  assert.equal(requestSnippet(null, "  just the preview "), "just the preview");
  assert.equal(requestSnippet("x".repeat(500), null).length, 400);
  assert.equal(repliedByLaserEntry(null, THREAD, messages), true);
  assert.equal(repliedByLaserEntry("Client <c@client.in>", "hello", parseThreadMessages("hello")), false);
  assert.equal(repliedByLaserEntry("Laser Entry <LaserEntry.Four@gmail.com>", "", []), true);
});

test("attachmentsOf: placeholders and blanks dropped, links kept by position", () => {
  assert.deepEqual(attachmentsOf(["a.pdf", " [No Attachments] ", "", 5, " b.xlsx "], ["https://drive/a", "", "", "", "[No Links]"]), [
    { name: "a.pdf", link: "https://drive/a" },
    { name: "b.xlsx", link: null },
  ]);
  assert.deepEqual(attachmentsOf(null, null), []);
  assert.deepEqual(attachmentsOf({ value: ["a.pdf"] }, null), []);
});

test("slice: filters and search reset the page; clear keeps sort and page size", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setPage(4));
  s = reducer(s, setFilter({ key: "aiCheck", values: ["Not verified"] }));
  assert.equal(s.page, 1);
  assert.deepEqual(queryOf(s).filters, { aiCheck: ["Not verified"] });
  s = reducer(s, setSearch("valve"));
  s = reducer(s, setPage(2));
  s = reducer(s, clearFilters());
  assert.deepEqual({ filters: s.filters, search: s.search, page: s.page, pageSize: s.pageSize }, { filters: {}, search: "", page: 1, pageSize: 25 });
  s = reducer(s, setFilter({ key: "files", values: ["Yes"] }));
  s = reducer(s, setFilter({ key: "files", values: [] }));
  assert.deepEqual(s.filters, {});
});

// Live DB smoke, read-only: PENDING_DOCKETS_SMOKE=1 QUOTATION_DATABASE_URL=... pnpm test
test("page, facet and thread queries run against the quotation DB", { skip: !process.env.PENDING_DOCKETS_SMOKE }, async () => {
  const { prisma } = await import("@gmd/db-quotation");
  const ids = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM docket_quotation_threads ORDER BY date DESC NULLS LAST LIMIT 40`;
  const live: PendingScope = { rows: ids.map((r, i) => ({ id: r.id, ai: (["Verified", "Verifying", "Not verified"] as const)[i % 3] })), aiEnabled: true, aiMaxAttempts: 3 };
  const page = await listPendingDocketsPage(live, { ...base, pageSize: 5, sort: { key: "requester", dir: "asc" } });
  console.log(JSON.stringify({ total: page.total, meta: page.meta, first: { ...page.rows[0], snippet: page.rows[0]?.snippet.slice(0, 60) } }));
  assert.equal(page.total, ids.length);
  assert.ok(page.rows.length <= 5);
  for (const c of PENDING_COLUMNS.filter((c) => c.filter && c.kind === "text")) {
    const values = await listPendingDocketsFacet(live, c.key, base);
    assert.ok(Array.isArray(values) && values.length > 0, c.key);
  }
  const searched = await listPendingDocketsPage(live, { ...base, search: page.rows[0].subject.slice(0, 6), dateRanges: { date: { from: "2020-01-01", to: "" } } });
  assert.ok(searched.total >= 1);
  const thread = await getPendingThread(Number(page.rows[0].id));
  assert.ok(thread && thread.messages.length >= 1);
});
