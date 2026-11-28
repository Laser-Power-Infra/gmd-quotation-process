import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@gmd/db-tender";
import { ALLOCATION_HEADERS, CONTRACT_REVIEW_HEADERS, dbContractReviewToRow } from "../src/lib/columns";
import { CR_COLUMNS, crColumn } from "../src/lib/crColumns";
import { DEFAULT_CONTRACT_REVIEW_FLAGS } from "../src/flags";
import { enabledTrees } from "../src/ui/graph_flow/tree";
import { computeView, type ViewContext } from "../src/lib/view";
import { loadContractReviewItems, toContractReviewData } from "../src/server/index";
import {
  BLANK_STATUS_SCOPE,
  buildOrderBy,
  buildPresence,
  buildWhere,
  flowNodes,
  listContractReviewFacet,
  listContractReviewPage,
  normalizeQuery,
  pageSql,
  type QueryContext,
} from "../src/server/query";
import type { ContractReviewViewQuery } from "../src/types";

const all = () => true;
const ctx: QueryContext = { isEnabled: all, scope: Prisma.sql`TRUE` };
const query = (over: Partial<ContractReviewViewQuery> = {}) =>
  normalizeQuery({ ...over } as ContractReviewViewQuery);
const flat = (q: Prisma.Sql) => q.sql.replace(/\s+/g, " ");
const where = (over: Partial<ContractReviewViewQuery>, c = ctx, skip = {}) => buildWhere(query(over), c, skip);

test("every header has a column rule that reads the same field as the row mapper", () => {
  assert.equal(CR_COLUMNS.length, CONTRACT_REVIEW_HEADERS.length);
  // A row whose every field holds its own name: the cell at a header must be that header's field.
  const lists = new Set(CR_COLUMNS.filter((c) => c.kind === "list").map((c) => c.field));
  const item = Object.fromEntries(
    CR_COLUMNS.filter((c) => c.field).map((c) => [c.field, lists.has(c.field) ? [c.field] : c.field]),
  );
  const row = dbContractReviewToRow(item as unknown as Parameters<typeof dbContractReviewToRow>[0]);
  CR_COLUMNS.forEach((c, i) => {
    if (c.field) assert.equal(row[i], c.field, c.header);
  });
  assert.deepEqual(
    CR_COLUMNS.filter((c) => !c.field).map((c) => c.header),
    ["RATE DIFF %", "PROD ENTRY QTY", "DATA INCOMPLETE"],
  );
  assert.equal(CR_COLUMNS.find((c) => c.header === "MC DATE")?.kind, "date");
  assert.equal(CR_COLUMNS.find((c) => c.header === "DI DATE")?.kind, "list");
  assert.equal(CR_COLUMNS.find((c) => c.header === "RATE")?.kind, "number");
});

test("buildWhere: no filters is just the scope", () => {
  assert.equal(flat(where({})), "TRUE");
  assert.match(flat(where({}, { ...ctx, scope: BLANK_STATUS_SCOPE })), /^\(c\."status" IS NULL OR c\."status" = ''\)$/);
});

test("buildWhere: text, blank, multi-select and sentinels", () => {
  const text = where({ columnFilters: { Remarks: "Foo  Bar", "PO NO": "(Blank)", Item: "All" } });
  assert.match(flat(text), /regexp_replace\(lower\(btrim\(coalesce\(c\."remarks", ''\)\)\), '\\s', '', 'g'\) LIKE \?/);
  assert.match(flat(text), /btrim\(coalesce\(c\."poNo", ''\)\) = ''/);
  assert.ok(text.values.includes("%foobar%"));
  assert.doesNotMatch(flat(text), /c\."item"/);

  const multi = where({ multiFilters: { "CLEARANCE STATUS": ["APPROVED", "(Blank)"], "BAL BILL AG CONT": ["(Non-Zero)"] } });
  assert.match(flat(multi), /btrim\(coalesce\(c\."clearanceStatus", ''\)\) = ANY\(\?::text\[\]\)/);
  assert.match(flat(multi), /NOT coalesce\(/);
  assert.ok(multi.values.some((v) => Array.isArray(v) && v.includes("APPROVED")));

  const drawing = where({ multiFilters: { "Upload Drawing": ["Has Drawing"] } });
  assert.match(flat(drawing), /btrim\(coalesce\(c\."diagramUrl", ''\)\) <> ''/);

  const actuator = where({ multiFilters: { Actuator: ["Pending Actuations"] } });
  assert.match(flat(actuator), /position\('actuator' in /);
});

test("buildWhere: unknown and disabled columns never filter", () => {
  assert.equal(flat(where({ columnFilters: { Nope: "x" }, multiFilters: { Nope: ["x"] } })), "TRUE");
  // RATE DIFF % is computed from RATE, so it goes with it (as in the tender flags).
  const noRate: QueryContext = { ...ctx, isEnabled: (h) => !["RATE", "RATE DIFF %", "STATUS"].includes(h) };
  const w = where({ columnFilters: { RATE: "5" }, statusFilter: ["Closed"], globalSearch: "abc" }, noRate);
  assert.doesNotMatch(flat(w), /c\."rate"|c\."status"/);
});

test("buildWhere: dates compare as yyyymmdd keys", () => {
  const w = where({ dateRanges: { "MC DATE": { from: "2026-01-05", to: "2026-02-01" } } });
  assert.ok(w.values.includes(20260105) && w.values.includes(20260201));
  assert.match(flat(w), /IS NOT NULL/);
  const blank = where({ dateRanges: { "MC DATE": { from: "", to: "", blank: true } } });
  assert.match(flat(blank), /btrim\(coalesce\(c\."mcDate", ''\)\) IN \('', '-', '—'\)/);
  // DI DATE is a list: its first date is the one compared.
  assert.match(flat(where({ dateRanges: { "DI DATE": { from: "2026-01-05", to: "" } } })), /\(c\."diDate"\)\[1\]/);
});

test("buildWhere: sidebar, rate tile and batch filters, and their exclusions", () => {
  const q = {
    statusFilter: ["Closed", "Blanks"],
    tileItems: ["Gate"],
    balBillFilter: "yes" as const,
    activeRateTile: "rateXOrderQty" as const,
    batchFilters: { nBatch: true },
    multiFilters: { "PN RATING": ["PN10"] },
  };
  const full = flat(where(q));
  assert.match(full, /lower\(btrim\(coalesce\(c\."status", ''\)\)\) = ANY/);
  assert.match(full, /c\."item", ''\)\) = ANY/);
  assert.match(full, /c\."nBatch", ''\)\) = \?/);
  assert.match(full, /c\."orderQty"/);
  // PN RATING is both a table filter and a sidebar filter.
  assert.equal(full.match(/c\."pnRating", ''\)\) = ANY/g)?.length, 2);

  assert.doesNotMatch(flat(where(q, ctx, { sidebar: "status" })), /c\."status"/);
  assert.doesNotMatch(flat(where(q, ctx, { header: "PN RATING", sidebar: "pn" })), /c\."pnRating"/);
  const noSidebar = flat(where(q, ctx, { sidebar: "all" }));
  assert.doesNotMatch(noSidebar, /c\."status"|c\."item"/);
  // The table filter survives when only the sidebar is dropped.
  assert.equal(noSidebar.match(/c\."pnRating", ''\)\) = ANY/g)?.length, 1);
  assert.doesNotMatch(flat(where(q, ctx, { ignore: new Set(["PN RATING"]), sidebar: "all" })), /c\."pnRating"/);
});

test("buildWhere: BOM ID category needs the quotation lookup", () => {
  const q = { columnFilters: { "BOM ID": "Single,Blanks" } };
  assert.equal(flat(where(q)), "TRUE");
  const w = where(q, { ...ctx, bom: { single: ["A"], multi: ["B"] } });
  assert.match(flat(w), /c\."itemCode" = ANY\(\?::text\[\]\) OR NOT \(c\."itemCode" = ANY/);
});

test("buildPresence: drawing and image; image needs the lookup", () => {
  assert.equal(flat(buildPresence(query({}), ctx)), "TRUE");
  const q = query({ presence: { drawing: true, image: true } });
  assert.match(flat(buildPresence(q, ctx)), /c\."diagramUrl", ''\)\) <> '' AND FALSE/);
  assert.match(flat(buildPresence(q, { ...ctx, imageCodes: ["A"] })), /btrim\(c\."itemCode"\) = ANY/);
});

test("buildOrderBy by kind, fallback for unknown / disabled / none", () => {
  const fallback = 'c."syncedAt" DESC, c.id ASC';
  assert.equal(flat(buildOrderBy(null, all)), fallback);
  assert.equal(flat(buildOrderBy({ header: "Nope", direction: "asc" }, all)), fallback);
  assert.equal(flat(buildOrderBy({ header: "RATE", direction: "asc" }, () => false)), fallback);
  assert.match(flat(buildOrderBy({ header: "RATE", direction: "desc" }, all)), /= ''\) ASC, .* DESC NULLS LAST, lower\(.*\) DESC, c\."syncedAt" DESC/);
  assert.match(flat(buildOrderBy({ header: "MC DATE", direction: "asc" }, all)), /split_part.* ASC NULLS LAST/);
});

test("flow nodes carry their whole path; the graph base ignores graph columns and the sidebar", () => {
  const nodes = flowNodes(all);
  const count = (n: { children?: unknown[] }): number =>
    1 + ((n.children ?? []) as { children?: unknown[] }[]).reduce((s, k) => s + count(k), 0);
  assert.equal(nodes.length, enabledTrees(all).reduce((s, t) => s + count(t.tree), 0));
  const approved = nodes.find((n) => n.id === "liveApproved")!;
  assert.match(flat(approved.where), /c\."status".*AND.*c\."clearanceStatus"/);
  // STATUS disabled (tender): every tree hangs off STATUS, so there is no diagram.
  assert.equal(flowNodes((h) => h !== "STATUS").length, 0);
  assert.equal(pageSql(query({}), { ...ctx, isEnabled: (h) => h !== "STATUS" }).graph, null);

  const s = pageSql(query({ multiFilters: { STATUS: ["(Blank)"], Item: ["Gate"] }, statusFilter: ["Closed"] }), ctx);
  const graphWhere = flat(s.graph!).split(" WHERE ").at(-1)!;
  assert.doesNotMatch(graphWhere, /c\."status"/);
  assert.match(graphWhere, /c\."item"/);
});

test("stock allocation columns never reach WHERE / ORDER BY / facets and are not DATA INCOMPLETE", async () => {
  const fallback = 'c."syncedAt" DESC, c.id ASC';
  for (const h of ALLOCATION_HEADERS) {
    // No column rule, so no cell SQL: the DATA INCOMPLETE fallthrough in cellSql never sees them.
    assert.equal(crColumn(h), undefined, h);
    const w = where({ columnFilters: { [h]: "5" }, multiFilters: { [h]: ["Partial"] }, dateRanges: { [h]: { from: "2026-01-01", to: "" } } });
    assert.equal(flat(w), "TRUE", h);
    assert.equal(flat(buildOrderBy({ header: h, direction: "asc" }, all)), fallback, h);
    assert.deepEqual(await listContractReviewFacet(query({}), h, { flags: DEFAULT_CONTRACT_REVIEW_FLAGS }), [], h);
  }
});

test("disabled columns read as NULL in the totals", () => {
  const s = pageSql(query({}), { ...ctx, isEnabled: (h) => h !== "RATE" });
  assert.match(flat(s.totals), /sum\(NULL::numeric \* /);
  assert.doesNotMatch(flat(s.totals), /c\."rate"/);
});

// Live, read-only: the SQL engine against the JS engine over the whole table.
// CR_SMOKE=1 TENDER_DATABASE_URL=... pnpm test   (downloads every row once)
test("SQL results agree with the JS engine", { skip: !process.env.CR_SMOKE, timeout: 900_000 }, async () => {
  const flags = DEFAULT_CONTRACT_REVIEW_FLAGS;
  const data = toContractReviewData(await loadContractReviewItems());
  const jsCtx: ViewContext = {
    headers: data.headers,
    rows: data.rows,
    bomCategoryByRow: new WeakMap(),
    trees: enabledTrees(all),
    batchPresenceFilters: [],
  };
  // Filters whose rules are meant to be identical. Not covered on purpose:
  // global search (no longer spans cells) and cells like "12abc" (no longer numbers).
  const scenarios: Record<string, Partial<ContractReviewViewQuery>> = {
    none: {},
    status: { statusFilter: ["Blanks"] },
    clearance: { multiFilters: { "CLEARANCE STATUS": ["APPROVED", "(Blank)"] } },
    mcAndInspection: { multiFilters: { "MC Received/Pending": ["Received"], Inspection: ["DONE"] } },
    rateTile: { activeRateTile: "rateXOrderQty" },
    balBill: { balBillFilter: "yes" },
    nodeClick: { multiFilters: { "BAL BILL AG CONT": ["(Non-Zero)"], "DI DATE": ["(Has Value)"] } },
    drawing: { multiFilters: { "Upload Drawing": ["Has Drawing"] } },
  };
  const near = (a: number, b: number, label: string) =>
    assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-6, `${label}: sql ${a} vs js ${b}`);
  for (const [name, over] of Object.entries(scenarios)) {
    const q = query(over);
    const sqlPage = await listContractReviewPage(q, { flags });
    const js = computeView(jsCtx, q);
    assert.equal(sqlPage.total, js.matchedIdx.length, `${name}: total`);
    assert.deepEqual(sqlPage.view.statusCounts, js.view.statusCounts, `${name}: statusCounts`);
    assert.deepEqual(sqlPage.view.clearanceCounts, js.view.clearanceCounts, `${name}: clearanceCounts`);
    assert.deepEqual(sqlPage.view.graphCounts, js.view.graphCounts, `${name}: graphCounts`);
    assert.deepEqual(sqlPage.view.tileAllCounts.item, js.view.tileAllCounts.item, `${name}: tileAll item`);
    assert.equal(sqlPage.view.contractCount, js.view.contractCount, `${name}: contractCount`);
    near(sqlPage.view.rateOrderQty.sum, js.view.rateOrderQty.sum, `${name}: rateOrderQty`);
    near(sqlPage.view.balBillAgContTotal.sum, js.view.balBillAgContTotal.sum, `${name}: balBill`);
    assert.equal(sqlPage.rows.length, Math.min(25, sqlPage.total), `${name}: page rows`);
  }
  const facet = await listContractReviewFacet(query({}), "CLEARANCE STATUS", { flags });
  assert.deepEqual(facet, Object.keys(computeView(jsCtx, query({})).view.clearanceCounts).filter((k) => k !== "all" && k !== "(Blank)").sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
});
