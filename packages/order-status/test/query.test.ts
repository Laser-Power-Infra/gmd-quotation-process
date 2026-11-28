import test from "node:test";
import assert from "node:assert/strict";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import { ORDER_COLUMNS, PENDING_WITH, STAGES, lightOf, producedText } from "../src/columns";
import { buildOrderBy, buildWhere, getContractDetail, listOrderStatusExport, listOrderStatusFacet, listOrderStatusPage, pageSql } from "../src/server/query";
import reducer, { clearFilters, queryOf, setFilter, setPage, setShowDone } from "../src/state/tableSlice";

const base = { page: 1, pageSize: 50, sort: null, search: "", filters: {} };
const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");
const HIDE_DONE = /c\."stageNo" < \?/;

test("buildWhere: facets, blank, search; unknown and non-filter keys are ignored", () => {
  const w = buildWhere({ ...base, filters: { party: ["ACME", BLANK], bogus: ["x"], items: ["3"] }, search: "ab c" });
  assert.match(flat(w), /\(c\."party" = \? OR c\."party" = ''\)/);
  assert.match(flat(w), /ILIKE \?/);
  assert.deepEqual(w.values, ["ACME", STAGES.length - 1, "%abc%"]);
  assert.ok(!w.sql.includes("bogus") && !w.sql.includes('c."items"'));
});

test("fully billed contracts stay hidden until the toggle or a picked stage asks for them", () => {
  assert.match(flat(buildWhere(base)), HIDE_DONE);
  assert.equal(buildWhere({ ...base, extra: { showDone: true } }).sql, "TRUE");
  assert.doesNotMatch(flat(buildWhere({ ...base, filters: { stage: ["Fully billed"] } })), HIDE_DONE);
  assert.doesNotMatch(flat(buildWhere({ ...base, columnSearch: { stage: "billed" } })), HIDE_DONE);
  // The stage tiles and the stage facet count every stage, done included.
  assert.equal(buildWhere(base, "stage").sql, "TRUE");
  assert.equal(buildWhere({ ...base, filters: { stage: ["Bill"] } }, "stage").sql, "TRUE");
  // Only a real boolean turns it on.
  assert.match(flat(buildWhere({ ...base, extra: { showDone: "true" } })), HIDE_DONE);
});

test("buildWhere: date range on the date column only; column search squashes spaces", () => {
  const w = buildWhere({
    ...base,
    extra: { showDone: true },
    dateRanges: { contractDate: { from: "2026-01-01", to: "2026-01-31" }, party: { from: "2026-01-01", to: "" } },
    columnSearch: { contractNo: "gmd 12", items: "x" },
  });
  assert.match(flat(w), /c\."contractDate" >= \?::date AND c\."contractDate" <= \?::date/);
  assert.deepEqual(w.values, ["%gmd12%", "2026-01-01", "2026-01-31"]);
  assert.ok(!w.sql.includes('c."items"') && !/c\."party" >=/.test(w.sql));
});

test("buildOrderBy: stages in step order, text vs number, oldest contract first by default", () => {
  const fallback = buildOrderBy(null).sql;
  assert.match(flat(buildOrderBy(null)), /^f\."contractDate" ASC NULLS LAST, f\."contractNo"$/);
  assert.match(flat(buildOrderBy({ key: "stage", dir: "desc" })), /^f\."stageNo" DESC, /);
  assert.match(flat(buildOrderBy({ key: "value", dir: "asc" })), /^f\."value" ASC NULLS LAST, /);
  assert.match(flat(buildOrderBy({ key: "party", dir: "desc" })), /^NULLIF\(lower\(f\."party"\), ''\) DESC NULLS FIRST, /);
  assert.ok(buildOrderBy({ key: "party", dir: "asc" }).sql.endsWith(fallback));
  assert.equal(buildOrderBy({ key: "stageNo", dir: "asc" }).sql, fallback);
  assert.equal(buildOrderBy({ key: 'x"; drop', dir: "asc" }).sql, fallback);
});

test("pageSql: page size is capped, dates leave as ISO text, stage counts skip the stage filter", () => {
  const q = pageSql({ ...base, page: 2, pageSize: 1000, filters: { stage: ["Bill"] } });
  assert.match(flat(q.rows), /LIMIT \? OFFSET \?$/);
  assert.deepEqual(q.rows.values.slice(-2), [200, 200]);
  assert.match(flat(q.rows), /to_char\(f\."contractDate", 'YYYY-MM-DD'\) AS "contractDate"/);
  const head = flat(q.head);
  // `total` applies the stage filter; the tiles (one count per stage) do not.
  assert.match(head, /\(count\(\*\) FILTER \(WHERE \(c\."stage" = \?\)\)\)::int AS total/);
  for (const s of STAGES) assert.ok(head.includes(`AS "${s}"`), s);
  assert.match(head, /FROM c WHERE TRUE$/);
});

test("stages, owners and columns line up", () => {
  assert.deepEqual([...STAGES], ["Order", "Production", "Inspection", "Dispatch", "Bill", "Fully billed"]);
  assert.deepEqual(Object.keys(PENDING_WITH), [...STAGES]);
  assert.ok(ORDER_COLUMNS.every((c) => !c.filter || c.kind === "text" || c.kind === "date"));
});

test("lightOf and producedText", () => {
  assert.equal(lightOf("Bill", 30), "green");
  assert.equal(lightOf("Bill", 90), "amber");
  assert.equal(lightOf("Bill", 200), "red");
  assert.equal(lightOf("Fully billed", 200), "green");
  assert.equal(lightOf("Order", null), "green");
  assert.equal(producedText({ producedQty: 8, producedOf: 15, lastEntry: "15-Feb-2024" }), "Produced 8 of 15 (last entry 15-Feb-2024)");
  assert.equal(producedText({ producedQty: 4, producedOf: 4, lastEntry: null }), "Produced 4 of 4");
  // No line on a production order with a known entry qty: nothing to report.
  assert.equal(producedText({ producedQty: null, producedOf: null, lastEntry: "15-Feb-2024" }), null);
});

test("slice: filters reset the page; the fully-billed toggle travels in extra and survives Clear all", () => {
  let s = reducer(undefined, { type: "init" });
  s = reducer(s, setPage(3));
  s = reducer(s, setFilter({ key: "party", values: ["ACME"] }));
  assert.equal(s.page, 1);
  s = reducer(s, setShowDone(true));
  s = reducer(s, clearFilters());
  assert.deepEqual(queryOf(s).filters, {});
  assert.deepEqual(queryOf(s).extra, { showDone: true });
});

// ---- Live DB: ORDER_STATUS_SMOKE=1 with TENDER_DATABASE_URL and QUOTATION_DATABASE_URL set. Reads only. ----

// The JS rules the SQL replaced (the app's old lib/executionPages stageOf / num / producedSummary): the oracle here.
const jsNum = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};
const sheetNumber = (v: unknown) => parseFloat(String(v ?? "").replace(/,/g, ""));
type RawLine = {
  contractNo: string; orderQty: string | null; billedQty: string | null; diQty: string | null; prodOrdQty: string | null; rate: string | null;
  balanceToProdEnt: string | null; prodEntryDate: string | null; productionOrderNumber: string | null;
  offerNumber: string[]; inspectionNumber: string[]; diDate: string[];
};
function jsStage(r: RawLine): number {
  const [order, billed, di, prod] = [jsNum(r.orderQty), jsNum(r.billedQty), jsNum(r.diQty), jsNum(r.prodOrdQty)];
  if (order > 0 && billed >= order) return 5;
  if (di > billed || (r.diDate.length > 0 && billed < order)) return 4;
  if (r.inspectionNumber.length > 0) return 3;
  if (r.offerNumber.length > 0) return 2;
  if (prod > 0 || r.productionOrderNumber) return 1;
  return 0;
}
function jsProduced(lines: RawLine[]): string | null {
  const entry = (l: RawLine) => {
    const q = sheetNumber(l.prodOrdQty) - sheetNumber(l.balanceToProdEnt);
    return Number.isFinite(q) && q >= 0 ? q : null;
  };
  const known = lines.filter((l) => entry(l) !== null && jsNum(l.prodOrdQty) > 0);
  if (known.length === 0) return null;
  const last = lines
    .map((l) => l.prodEntryDate)
    .filter((d): d is string => parseGmdDate(d) !== null)
    .sort((a, b) => parseGmdDate(b)!.getTime() - parseGmdDate(a)!.getTime())[0];
  return `Produced ${known.reduce((s, l) => s + entry(l)!, 0)} of ${known.reduce((s, l) => s + jsNum(l.prodOrdQty), 0)}${last ? ` (last entry ${last})` : ""}`;
}

test("live: pages, facets, detail and export agree with the old JS rules", { skip: !process.env.ORDER_STATUS_SMOKE }, async () => {
  const { prisma } = await import("@gmd/db-tender");
  const all = { ...base, pageSize: 200, extra: { showDone: true } };
  const t0 = Date.now();
  const page = await listOrderStatusPage(all);
  console.log("page ms", Date.now() - t0, JSON.stringify({ total: page.total, meta: page.meta, first: page.rows[0] }));
  assert.ok(page.rows.length > 0 && page.total >= page.rows.length);
  assert.equal(Object.values(page.meta!.stages).reduce((a, b) => a + b, 0), page.total);
  const hidden = await listOrderStatusPage({ ...base, pageSize: 5 });
  assert.equal(hidden.total, page.total - page.meta!.stages["Fully billed"]);

  for (const c of ORDER_COLUMNS.filter((c) => c.filter && c.kind === "text")) {
    const values = await listOrderStatusFacet(c.key, base);
    assert.ok(Array.isArray(values) && values.length > 0, c.key);
  }
  assert.deepEqual(await listOrderStatusFacet("stage", all), STAGES.filter((s) => page.meta!.stages[s] > 0));

  // Every contract on the first page against the raw lines, read the old way.
  const nos = page.rows.map((r) => r.contractNo);
  const raw = await prisma.contractReview.findMany({
    where: { contractNo: { in: nos } },
    select: { contractNo: true, orderQty: true, billedQty: true, diQty: true, prodOrdQty: true, rate: true, balanceToProdEnt: true, prodEntryDate: true, productionOrderNumber: true, offerNumber: true, inspectionNumber: true, diDate: true },
  });
  for (const row of page.rows) {
    const lines = raw.filter((l) => l.contractNo === row.contractNo);
    assert.equal(row.items, lines.length, row.contractNo);
    assert.equal(row.stage, STAGES[Math.min(...lines.map(jsStage))], row.contractNo);
    assert.ok(Math.abs(row.value - lines.reduce((s, l) => s + jsNum(l.orderQty) * jsNum(l.rate), 0)) < 0.01, row.contractNo);
    assert.equal(producedText(row), jsProduced(lines), row.contractNo);
  }

  const first = page.rows[0];
  const detail = await getContractDetail(first.contractNo);
  assert.equal(detail.lines.length, first.items);
  const exported = await listOrderStatusExport({ ...all, filters: { contractNo: [first.contractNo] } });
  assert.equal(exported.length, first.items);
  assert.equal(exported[0][0], first.contractNo);
  console.log("detail", JSON.stringify({ lines: detail.lines.length, invoices: detail.invoices.length, exported: exported[0] }));
});
