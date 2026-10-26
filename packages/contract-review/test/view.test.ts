import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_REVIEW_HEADERS } from "../src/lib/columns";
import { enabledTrees } from "../src/ui/graph_flow/tree";
import { flatten, pathTo } from "../src/ui/graph_flow/tree";
import {
  CONTRACT_NO_IDX,
  COST_FROM_QUOTATION_IDX,
  INSPECTION_IDX,
  ORDER_QTY_IDX,
  RATE_IDX,
  MC_IDX,
  STATUS_IDX,
  CLEARANCE_STATUS_IDX,
  applyPresence,
  computeFacet,
  computeView,
  matchesGraphFilter,
  matchesRateTile,
  matchesScope,
  matchesSidebar,
  matchesTableFilters,
  parseNum,
  sortRowIndexes,
  statusTitle,
  type ViewContext,
  type ViewQuery,
} from "../src/lib/view";

const headers = [...CONTRACT_REVIEW_HEADERS];
const col = (h: string) => headers.indexOf(h);

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeRows(n: number): unknown[][] {
  const r = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  return Array.from({ length: n }, (_, i) => {
    const row: unknown[] = headers.map(() => "");
    const set = (h: string, v: string) => (row[col(h)] = v);
    set("STATUS", pick(["", "", "", "Closed", "hold"]));
    set("CLEARANCE STATUS", pick(["", "APPROVED", "PENDING", "NA", "NR"]));
    set("MC Received/Pending", pick(["Received", "Pending", ""]));
    set("Inspection", pick(["DONE", "PENDING", ""]));
    set("Item", pick(["Gate", "Globe", "Check"]));
    set("SIZE", pick(["50", "80", "100"]));
    set("PN RATING", pick(["PN10", "PN16", ""]));
    set("RATE", pick(["100", "250.5", "", "1,000"]));
    set("ORDER QTY", pick(["1", "5", "10", ""]));
    set("BAL BILL AG CONT", pick(["0", "3", "7", ""]));
    set("DI QTY", pick(["2", "4", ""]));
    set("BILLED QTY", pick(["1", "2", ""]));
    set("MC QTY", pick(["3", "6", ""]));
    set("COST FROM QUOTATION", pick(["1000", "2500", ""]));
    set("VA % FROM COST", pick(["12", "18", ""]));
    set("CONTRACT NO", pick(["C1", "C2", "C3", ""]));
    set("PARTY NAME", pick(["Acme", "Beta"]));
    set("OFFER NUMBER", pick(["O1", ""]));
    set("INSPECTION NUMBER", pick(["I1", ""]));
    set("DI DATE", pick(["12-Mar-2025", ""]));
    set("Remarks", pick(["foo bar", "baz", ""]));
    set("ITEM_CODE", `CODE${i % 17}`);
    return row;
  });
}

const rows = makeRows(400);
const bomCategoryByRow = new WeakMap<unknown[], "Blanks" | "Single" | "Dropdown">();
rows.forEach((row, i) =>
  bomCategoryByRow.set(row, (["Blanks", "Single", "Dropdown"] as const)[i % 3]),
);

const ctx: ViewContext = {
  headers,
  rows,
  bomCategoryByRow,
  trees: enabledTrees(() => true),
  batchPresenceFilters: [],
  hasImage: (code) => code === "CODE1",
};

const base: ViewQuery = {
  columnFilters: {},
  multiFilters: {},
  batchFilters: {},
  dateRanges: {},
  globalSearch: "",
  balBillFilter: "all",
  statusFilter: "all",
  tileItems: [],
  tileSize: "",
  activeRateTile: null,
  presence: { drawing: false, image: false },
};

const scenarios: Record<string, Partial<ViewQuery>> = {
  none: {},
  status: { statusFilter: "Blanks" },
  statusNamed: { statusFilter: "Closed" },
  clearance: { multiFilters: { "CLEARANCE STATUS": ["APPROVED", "(Blank)"] } },
  items: { tileItems: ["Gate"], tileSize: "80" },
  mcAndInspection: {
    multiFilters: { "MC Received/Pending": ["Received"], Inspection: ["DONE"] },
  },
  pn: { multiFilters: { "PN RATING": ["PN10"] } },
  rateTile: { activeRateTile: "rateXOrderQty" },
  costTile: { activeRateTile: "totalCostIncGst", tileItems: ["Globe"] },
  text: { columnFilters: { Remarks: "foo" } },
  search: { globalSearch: "c1" },
  balBill: { balBillFilter: "yes" },
  graph: {
    multiFilters: {
      STATUS: ["(Blank)"],
      "CLEARANCE STATUS": ["APPROVED", "NA", "NR"],
    },
    statusFilter: "Blanks",
  },
  contract: { multiFilters: { "CONTRACT NO": ["C1"] } },
  bomCategory: { columnFilters: { "BOM ID": "Single" } },
  everything: {
    multiFilters: {
      "CLEARANCE STATUS": ["APPROVED"],
      Item: ["Gate"],
      "CONTRACT NO": ["C2"],
    },
    columnFilters: { Remarks: "baz" },
    tileItems: ["Gate"],
    activeRateTile: "rateXBalMcQty",
    statusFilter: "Blanks",
  },
};

// ---- Oracle: the pre-refactor logic, one independent full scan per aggregate.

function oracle(q: ViewQuery) {
  const clearanceFilter = q.multiFilters["CLEARANCE STATUS"] ?? [];
  const tilePns = q.multiFilters["PN RATING"] ?? [];
  const mcFilter = q.multiFilters["MC Received/Pending"] ?? [];
  const inspectionFilter = q.multiFilters["Inspection"] ?? [];
  const balIdx = col("BAL BILL AG CONT");
  const rowOk = (row: unknown[], exclude?: string, ignore?: Set<string>) =>
    matchesTableFilters(
      row,
      headers,
      q.columnFilters,
      q.multiFilters,
      q.globalSearch,
      q.dateRanges,
      exclude,
      ignore,
      bomCategoryByRow,
    ) && matchesRateTile(row, q.activeRateTile);
  const sb = (row: unknown[], ex?: Parameters<typeof matchesSidebar>[13]) =>
    matchesSidebar(
      row,
      q.balBillFilter,
      q.statusFilter,
      clearanceFilter,
      q.tileItems,
      q.tileSize,
      tilePns,
      mcFilter,
      inspectionFilter,
      balIdx,
      CLEARANCE_STATUS_IDX,
      MC_IDX,
      INSPECTION_IDX,
      ex,
    );

  const sidebarBase = rows.filter((r) => rowOk(r));
  const matched = sidebarBase.filter((r) => sb(r));

  const statusCounts: Record<string, number> = { all: 0 };
  for (const r of sidebarBase) {
    if (!sb(r, "status")) continue;
    statusCounts.all++;
    const cell = String(r[STATUS_IDX] ?? "").trim();
    const key = cell === "" ? "Blanks" : statusTitle(cell);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  const clearanceCounts: Record<string, number> = { all: 0 };
  for (const r of rows.filter((r) => rowOk(r, "CLEARANCE STATUS"))) {
    if (!sb(r, "clearance")) continue;
    clearanceCounts.all++;
    const cell = String(r[CLEARANCE_STATUS_IDX] ?? "").trim();
    const key = cell === "" ? "(Blank)" : cell;
    clearanceCounts[key] = (clearanceCounts[key] ?? 0) + 1;
  }

  const sumOf = (pick: (r: unknown[]) => number) => {
    let sum = 0;
    let count = 0;
    for (const r of matched) {
      const v = pick(r);
      if (isNaN(v)) continue;
      sum += v;
      count++;
    }
    return { sum, count };
  };

  const graphPath = new Set(["STATUS", "CLEARANCE STATUS"]);
  const graphCounts: Record<string, number> = {};
  for (const { tree, scope } of ctx.trees) {
    for (const node of flatten(tree)) {
      const path = pathTo(tree, node.id);
      graphCounts[node.id] = rows.filter(
        (r) =>
          rowOk(r, undefined, graphPath) &&
          matchesScope(r, scope) &&
          path.every((p) => matchesGraphFilter(r, p.filter)),
      ).length;
    }
  }

  const contractNoMeta: Record<string, { count: number; sum: number; partyName: string }> = {};
  for (const r of rows.filter((r) => sb(r))) {
    if (!rowOk(r, "CONTRACT NO")) continue;
    const cn = String(r[CONTRACT_NO_IDX] ?? "").trim();
    if (!cn) continue;
    const e = (contractNoMeta[cn] ??= { count: 0, sum: 0, partyName: "" });
    e.count++;
    const rate = parseNum(r[RATE_IDX]);
    const bal = parseNum(r[balIdx]);
    if (!isNaN(rate) && !isNaN(bal)) e.sum += rate * bal;
    if (!e.partyName) e.partyName = String(r[col("PARTY NAME")] ?? "").trim();
  }

  return {
    matchedCount: matched.length,
    statusCounts,
    clearanceCounts,
    contractCount: new Set(
      matched.map((r) => String(r[CONTRACT_NO_IDX] ?? "").trim()).filter(Boolean),
    ).size,
    rateOrderQty: sumOf((r) => parseNum(r[RATE_IDX]) * parseNum(r[ORDER_QTY_IDX])),
    totalCostIncGst: sumOf((r) => parseNum(r[COST_FROM_QUOTATION_IDX]) * 1.18),
    tileAllItem: sidebarBase.filter((r) => sb(r, "item")).length,
    graphCounts,
    contractNoMeta,
  };
}

for (const [name, patch] of Object.entries(scenarios)) {
  test(`computeView matches the independent scan: ${name}`, () => {
    const q: ViewQuery = { ...base, ...patch };
    const want = oracle(q);
    const got = computeView(ctx, q);
    assert.equal(got.matchedIdx.length, want.matchedCount, "matched rows");
    assert.equal(got.view.tileRowsCount, want.matchedCount, "tileRowsCount");
    assert.deepEqual(got.view.statusCounts, want.statusCounts);
    assert.deepEqual(got.view.clearanceCounts, want.clearanceCounts);
    assert.equal(got.view.contractCount, want.contractCount);
    assert.deepEqual(got.view.rateOrderQty, want.rateOrderQty);
    assert.equal(got.view.totalCostIncGst.count, want.totalCostIncGst.count);
    assert.ok(
      Math.abs(got.view.totalCostIncGst.sum - want.totalCostIncGst.sum) < 1e-6,
    );
    assert.equal(got.view.tileAllCounts.item, want.tileAllItem);
    assert.deepEqual(got.view.graphCounts, want.graphCounts);
    assert.deepEqual(got.view.contractNoMeta, want.contractNoMeta);
  });
}

test("visibleIdx is the sidebar + rate-tile subset without table filters", () => {
  const q: ViewQuery = {
    ...base,
    tileItems: ["Gate"],
    columnFilters: { Remarks: "foo" },
    activeRateTile: "rateXOrderQty",
  };
  const { visibleIdx, matchedIdx } = computeView(ctx, q, { wantVisible: true });
  assert.ok(matchedIdx.every((i) => visibleIdx.includes(i)));
  assert.ok(visibleIdx.length > matchedIdx.length);
  assert.ok(visibleIdx.every((i) => rows[i][col("Item")] === "Gate"));
});

test("facet options exclude the column's own filter but respect the others", () => {
  const q: ViewQuery = {
    ...base,
    multiFilters: { SIZE: ["50"], Item: ["Gate"] },
  };
  const sizes = computeFacet(ctx, q, "SIZE");
  // SIZE's own selection ignored, Item's still applied.
  const expected = [
    ...new Set(
      rows
        .filter((r) => r[col("Item")] === "Gate")
        .map((r) => String(r[col("SIZE")])),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assert.deepEqual(sizes, expected);
  assert.ok(sizes.length > 1);
});

test("sorting orders by value with data order as the tiebreaker", () => {
  const all = rows.map((_, i) => i);
  const asc = sortRowIndexes(rows, all, headers, { header: "ORDER QTY", direction: "asc" });
  const nums = asc
    .map((i) => parseNum(rows[i][ORDER_QTY_IDX]))
    .filter((n) => !isNaN(n));
  assert.deepEqual([...nums].sort((a, b) => a - b), nums);
  // Blanks sink to the end in either direction, equal values keep data order.
  const sameValue = asc.filter((i) => rows[i][ORDER_QTY_IDX] === "5");
  assert.deepEqual([...sameValue].sort((a, b) => a - b), sameValue);
  assert.deepEqual(sortRowIndexes(rows, all, headers, null), all);
});

test("presence checkboxes narrow the table rows only", () => {
  const all = rows.map((_, i) => i);
  const withImage = applyPresence(ctx, all, { drawing: false, image: true });
  assert.ok(withImage.length > 0);
  assert.ok(withImage.every((i) => rows[i][col("ITEM_CODE")] === "CODE1"));
  assert.equal(applyPresence(ctx, all, { drawing: false, image: false }), all);
});

test("Upload Drawing filter understands Has Drawing / No Drawing", () => {
  const withDrawing = rows.map((r, i) => {
    const copy = [...r];
    copy[col("Upload Drawing")] = i % 2 ? "https://x/y.pdf" : "";
    return copy;
  });
  const dctx: ViewContext = { ...ctx, rows: withDrawing };
  const q: ViewQuery = { ...base, multiFilters: { "Upload Drawing": ["Has Drawing"] } };
  const { matchedIdx } = computeView(dctx, q);
  assert.ok(matchedIdx.length > 0);
  assert.ok(matchedIdx.every((i) => i % 2 === 1));
});
