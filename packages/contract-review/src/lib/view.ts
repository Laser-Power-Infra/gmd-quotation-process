// Pure filter / aggregate pipeline for Contract Review. No React, no server-only
// imports: the page runs it in the browser (apps without a server view) and a
// host app can run the very same code on the server so both paths agree.

import { CONTRACT_REVIEW_HEADERS } from "./columns";
import { looseIncludes, squish } from "@gmd/dashboard/lib/squish";
import { BOM_ID_COLUMN, type BomIdCategory } from "@gmd/dashboard/lib/bomCategory";
import { isDateHeader } from "@gmd/dashboard/lib/sheet-columns";
import { cellCompare, compareDates } from "@gmd/dashboard/lib/tableSort";
import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_ZERO,
  FLOW_NON_ZERO,
  cellHasValue,
  cellIsZero,
} from "@gmd/dashboard/lib/flowFilter";
import {
  type enabledTrees,
  type FlowFilter,
  type FlowNode,
} from "../ui/graph_flow/tree";

export type BalBillFilter = "all" | "yes" | "no";

export type RateTileKey =
  | "rateXOrderQty"
  | "rateXBalBillAgCont"
  | "rateXMcQty"
  | "rateXBalDiQty"
  | "rateXBalMcQty"
  | "balBillAgContSum"
  | "totalCostExcGst"
  | "totalCostIncGst"
  | "totalVaPct";

export interface TileOption {
  value: string;
  count: number;
  sum?: number;
}

export interface Aggregate {
  sum: number;
  count: number;
}

export type DateRanges = Record<
  string,
  { from: string; to: string; blank?: boolean }
>;

export const ITEM_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Item");
export const EXTRA_ITEM_OPTION = "TPV + SLV METAL RISING - 9523";
export const SIZE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("SIZE");
export const PN_IDX = CONTRACT_REVIEW_HEADERS.indexOf("PN RATING");
export const RATE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("RATE");
export const MC_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("MC QTY");
export const BOM_ID_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BOM ID");
export const NO_USE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("RM AVAIL");
export const ACTUATOR_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Actuator");
export const RM_CODE_FOR_ACTUATOR_IDX = CONTRACT_REVIEW_HEADERS.indexOf(
  "RM CODE FOR ACTUATOR",
);
export const ORDER_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ORDER QTY");
export const DI_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("DI QTY");
export const BILLED_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BILLED QTY");
export const BAL_BILL_AG_CONT_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("BAL BILL AG CONT");
export const STATUS_IDX = CONTRACT_REVIEW_HEADERS.indexOf("STATUS");
export const ORDER_LIST_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ORDER LIST");
export const ITEM_NAME_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ITEM_NAME");
export const VA_PCT_FROM_COST_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("VA % FROM COST");
export const COST_FROM_QUOTATION_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("COST FROM QUOTATION");
export const CONTRACT_NO_IDX = CONTRACT_REVIEW_HEADERS.indexOf("CONTRACT NO");
export const ITEM_CODE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ITEM_CODE");
export const STATE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("STATE");
export const UTILITY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("UTILITY");
export const PROJECT_REFERENCE_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("PROJECT REFERENCE");
export const INSPECTION_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Inspection");
export const CLEARANCE_STATUS_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("CLEARANCE STATUS");
export const MC_IDX = CONTRACT_REVIEW_HEADERS.indexOf("MC Received/Pending");
export const OFFER_NUMBER_IDX = CONTRACT_REVIEW_HEADERS.indexOf("OFFER NUMBER");
export const OFFER_PENDING_DONE_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("OFFER PENDING/DONE");
export const UPLOAD_DRAWING_COLUMN = "Upload Drawing";
export const UPLOAD_DRAWING_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf(UPLOAD_DRAWING_COLUMN);

/**
 * Sentinel option shown in the Actuator column's filter dropdown, right after
 * `(Blank)`. Selects actuator item rows whose Actuator dropdown is still empty
 * - i.e. the actuations still pending data entry.
 */
export const PENDING_ACTUATIONS_FILTER = "Pending Actuations";

export function statusTitle(value: string): string {
  const s = value.trim();
  if (!s) return "Blanks";
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function isZeroBal(value: unknown): boolean {
  let s = String(value ?? "").trim();
  if (!s) return false;
  s = s.replace(/^["']+|["']+$/g, "").trim();
  const n = parseFloat(s.replace(/,/g, ""));
  return !isNaN(n) && n === 0;
}

export function parseNum(value: unknown): number {
  let s = String(value ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/^["']+|["']+$/g, "").replace(/,/g, "");
  return parseFloat(s);
}

export const fmt = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Whether this row's item is an actuator (so its Actuator dropdown renders). */
export function isActuatorItemRow(row: unknown[]): boolean {
  const n = String(row[ITEM_NAME_IDX] ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  return n.includes("actuator") || n.includes("_act") || n.includes("act+gb");
}

function isNumIdx(row: unknown[], idx: number): boolean {
  return !isNaN(parseNum(row[idx]));
}

export function matchesRateTile(
  row: unknown[],
  key: RateTileKey | null,
): boolean {
  if (!key) return true;
  switch (key) {
    case "rateXOrderQty":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, ORDER_QTY_IDX);
    case "rateXBalBillAgCont":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, BAL_BILL_AG_CONT_IDX);
    case "rateXMcQty":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, MC_QTY_IDX);
    case "rateXBalDiQty":
      return (
        isNumIdx(row, RATE_IDX) &&
        isNumIdx(row, DI_QTY_IDX) &&
        isNumIdx(row, BILLED_QTY_IDX)
      );
    case "rateXBalMcQty":
      return (
        isNumIdx(row, RATE_IDX) &&
        isNumIdx(row, MC_QTY_IDX) &&
        isNumIdx(row, DI_QTY_IDX)
      );
    case "balBillAgContSum":
      return isNumIdx(row, BAL_BILL_AG_CONT_IDX);
    case "totalCostExcGst":
    case "totalCostIncGst":
      return isNumIdx(row, COST_FROM_QUOTATION_IDX);
    case "totalVaPct":
      return isNumIdx(row, VA_PCT_FROM_COST_IDX);
    default:
      return true;
  }
}

function groupCount(
  rows: unknown[][],
  idx: number[],
  colIdx: number,
  filter: (row: unknown[]) => boolean,
): TileOption[] {
  const counts = new Map<string, number>();
  for (const i of idx) {
    const row = rows[i];
    if (!filter(row)) continue;
    const v = String(row[colIdx] ?? "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) =>
      a.value.localeCompare(b.value, undefined, { numeric: true }),
    );
}

function groupItemBalBill(
  rows: unknown[][],
  idx: number[],
  itemColIdx: number,
  balBillColIdx: number,
  filter: (row: unknown[]) => boolean,
): TileOption[] {
  const map = new Map<string, { count: number; sum: number }>();
  for (const i of idx) {
    const row = rows[i];
    if (!filter(row)) continue;
    const v = String(row[itemColIdx] ?? "").trim();
    if (!v) continue;
    const val = parseNum(balBillColIdx !== -1 ? row[balBillColIdx] : NaN);
    const prev = map.get(v) ?? { count: 0, sum: 0 };
    prev.count++;
    if (!isNaN(val)) {
      prev.sum += val;
    }
    map.set(v, prev);
  }
  return [...map.entries()]
    .map(([value, data]) => ({ value, count: data.count, sum: data.sum }))
    .sort((a, b) =>
      a.value.localeCompare(b.value, undefined, { numeric: true }),
    );
}

export type SidebarExclude =
  | "balBill"
  | "status"
  | "clearance"
  | "item"
  | "size"
  | "pn"
  | "mc"
  | "inspection";

export function matchesSidebar(
  row: unknown[],
  balBill: BalBillFilter,
  status: string,
  clearance: string[],
  item: string[],
  size: string,
  pn: string[],
  mc: string[],
  inspection: string[],
  balBillIdx: number,
  clearanceIdx: number,
  mcIdx: number,
  inspectionIdx: number,
  exclude?: SidebarExclude,
): boolean {
  if (exclude !== "balBill" && balBill !== "all") {
    const isYes = isZeroBal(row[balBillIdx]);
    const ok = balBill === "yes" ? isYes : !isYes;
    if (!ok) return false;
  }
  if (exclude !== "status" && status !== "all") {
    const cell = String(row[STATUS_IDX] ?? "").trim();
    if (status === "Blanks") {
      if (cell !== "") return false;
    } else if (cell.toLowerCase() !== status.toLowerCase()) {
      return false;
    }
  }
  if (exclude !== "clearance" && clearance.length > 0) {
    const cell = String(row[clearanceIdx] ?? "").trim();
    const isBlank = cell === "";
    const matchesBlank = clearance.includes("(Blank)") && isBlank;
    const matchesVal = clearance.includes(cell);
    if (!(matchesBlank || matchesVal)) return false;
  }
  if (exclude !== "item" && item.length > 0) {
    const cell = String(row[ITEM_IDX] ?? "").trim();
    if (!item.includes(cell)) return false;
  }
  if (
    exclude !== "size" &&
    size &&
    String(row[SIZE_IDX] ?? "").trim() !== size
  ) {
    return false;
  }
  if (exclude !== "pn" && pn.length > 0) {
    const cell = String(row[PN_IDX] ?? "").trim();
    const isBlank = cell === "";
    const matchesBlank = pn.includes("(Blank)") && isBlank;
    const matchesVal = pn.includes(cell);
    if (!(matchesBlank || matchesVal)) return false;
  }
  if (exclude !== "mc" && mc.length > 0) {
    const cell = String(row[mcIdx] ?? "").trim();
    const isBlank = cell === "";
    const matchesBlank = mc.includes("(Blank)") && isBlank;
    const matchesVal = mc.includes(cell);
    if (!(matchesBlank || matchesVal)) return false;
  }
  if (exclude !== "inspection" && inspection.length > 0) {
    const cell = String(row[inspectionIdx] ?? "").trim();
    const isBlank = cell === "";
    const matchesBlank = inspection.includes("(Blank)") && isBlank;
    const matchesVal = inspection.includes(cell);
    if (!(matchesBlank || matchesVal)) return false;
  }
  return true;
}

// The lowercased "whole row" string the global search matches against. Rows are
// immutable once loaded (edits replace the row array), so the identity cache is
// safe and spares rebuilding it for every keystroke / every aggregate pass.
const rowHayCache = new WeakMap<unknown[], string>();
function rowHay(row: unknown[], headerCount: number): string {
  let hay = rowHayCache.get(row);
  if (hay === undefined) {
    const parts: string[] = new Array(headerCount);
    for (let i = 0; i < headerCount; i++)
      parts[i] = squish(row[i]);
    hay = parts.join("");
    rowHayCache.set(row, hay);
  }
  return hay;
}

/**
 * Contract Review's mirror of GMDUpdateTable's `rowPassesFilters`. Used to build the
 * sidebar aggregates, the flow-graph node counts and the CONTRACT NO option metadata,
 * and (server mode) to filter the rows before paging.
 *
 * `bomCategoryByRow` supplies the BOM ID column's category (Blanks / Single / Dropdown)
 * per row. When supplied, the BOM ID filter is evaluated as a category instead of
 * falling through to the generic text match below, which would reject every row
 * (no BOM id contains "single"/"dropdown"/"blanks"). See `lib/bomCategory.ts`.
 */
export function matchesTableFilters(
  row: unknown[],
  headers: string[],
  columnFilters: Record<string, string>,
  multiFilters: Record<string, string[]>,
  globalSearch: string,
  dateRanges?: DateRanges,
  excludeHeader?: string,
  ignoreColumns?: Set<string>,
  bomCategoryByRow?: WeakMap<unknown[], BomIdCategory>,
): boolean {
  if (globalSearch.trim()) {
    const q = squish(globalSearch);
    if (!rowHay(row, headers.length).includes(q)) return false;
  }
  for (const [colName, filterVal] of Object.entries(columnFilters)) {
    if (excludeHeader && colName === excludeHeader) continue;
    if (ignoreColumns?.has(colName)) continue;
    if (!filterVal || filterVal === "All") continue;
    if (colName === BOM_ID_COLUMN && bomCategoryByRow) {
      const cat = bomCategoryByRow.get(row);
      // Rows with no known category (no id yet) pass through, mirroring
      // GMDUpdateTable's `if (!opts.id) continue`.
      if (cat !== undefined && cat !== filterVal) return false;
      continue;
    }
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "");
    if (filterVal === "(Blank)" || filterVal === "-" || filterVal === "—") {
      if (cellVal !== "") return false;
    } else if (!looseIncludes(cellVal, filterVal)) {
      return false;
    }
  }
  for (const [colName, selected] of Object.entries(multiFilters)) {
    if (excludeHeader && colName === excludeHeader) continue;
    if (ignoreColumns?.has(colName)) continue;
    if (!selected.length) continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "").trim();
    // The attachment column filter is "Has Drawing" / "No Drawing" (the table's
    // `filterAttachmentColumn` mode), not a cell-value match.
    if (colName === UPLOAD_DRAWING_COLUMN) {
      const hasDrawing = cellVal !== "";
      if (
        !(
          (selected.includes("Has Drawing") && hasDrawing) ||
          (selected.includes("No Drawing") && !hasDrawing)
        )
      )
        return false;
      continue;
    }
    const matchesBlank = selected.includes("(Blank)") && cellVal === "";
    const matchesHasValue =
      selected.includes(FLOW_HAS_VALUE) && cellHasValue(cellVal);
    const matchesNoValue =
      selected.includes(FLOW_NO_VALUE) && !cellHasValue(cellVal);
    const matchesZero = selected.includes(FLOW_ZERO) && cellIsZero(cellVal);
    const matchesNonZero =
      selected.includes(FLOW_NON_ZERO) && !cellIsZero(cellVal);
    const matchesPendingActuation =
      colName === "Actuator" &&
      selected.includes(PENDING_ACTUATIONS_FILTER) &&
      isActuatorItemRow(row) &&
      cellVal === "";
    if (
      !(
        matchesBlank ||
        matchesHasValue ||
        matchesNoValue ||
        matchesZero ||
        matchesNonZero ||
        matchesPendingActuation ||
        selected.includes(cellVal)
      )
    )
      return false;
  }
  if (dateRanges) {
    for (const [colName, r] of Object.entries(dateRanges)) {
      if (excludeHeader && colName === excludeHeader) continue;
      if (ignoreColumns?.has(colName)) continue;
      if (!r.from && !r.to && !r.blank) continue;
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) continue;
      const dateStr = String(row[colIdx] ?? "");
      if (r.blank) {
        const isBlank = dateStr === "" || dateStr === "-" || dateStr === "—";
        if (!isBlank) return false;
        continue;
      }
      if (!dateStr) return false;
      const date = parseGmdDate(dateStr);
      if (!date) return false;
      const fromDate = r.from ? new Date(r.from + "T00:00:00") : null;
      const toEnd = r.to ? new Date(r.to + "T23:59:59") : null;
      if (fromDate && date < fromDate) return false;
      if (toEnd && date > toEnd) return false;
    }
  }
  return true;
}

const graphColIdxCache = new Map<string, number>();
function graphColIdx(column: string): number {
  let idx = graphColIdxCache.get(column);
  if (idx === undefined) {
    idx = (CONTRACT_REVIEW_HEADERS as readonly string[]).indexOf(column);
    graphColIdxCache.set(column, idx);
  }
  return idx;
}

/** Whether a row satisfies a single graph node filter (exact cell match). */
export function matchesGraphFilter(row: unknown[], filter: FlowFilter): boolean {
  const colIdx = graphColIdx(filter.column);
  // Column not in the data yet (e.g. DI Received / Dispatch / DI Balance):
  // pass through so partially-built tree levels don't zero out the subtree.
  if (colIdx === -1) return true;
  const cell = String(row[colIdx] ?? "").trim();
  const matchesBlank = filter.values.includes("(Blank)") && cell === "";
  const matchesHasValue =
    filter.values.includes(FLOW_HAS_VALUE) && cellHasValue(cell);
  const matchesNoValue =
    filter.values.includes(FLOW_NO_VALUE) && !cellHasValue(cell);
  const matchesZero = filter.values.includes(FLOW_ZERO) && cellIsZero(cell);
  const matchesNonZero =
    filter.values.includes(FLOW_NON_ZERO) && !cellIsZero(cell);
  return (
    matchesBlank ||
    matchesHasValue ||
    matchesNoValue ||
    matchesZero ||
    matchesNonZero ||
    filter.values.includes(cell)
  );
}

/**
 * Whether a row satisfies a tree-level scope. The mini-graphs carry
 * `LIVE_SCOPE`, so their counts and clicks only ever touch Live rows.
 */
export function matchesScope(row: unknown[], scope?: FlowFilter): boolean {
  return !scope || matchesGraphFilter(row, scope);
}

/** Reduce a node path to one constraint per column (last level wins). */
export function pathToColumnFilters(
  path: { filter: FlowFilter }[],
  scope?: FlowFilter,
): Record<string, string[]> {
  const byCol: Record<string, string[]> = {};
  // The scope is part of what a click means, so it has to reach the table too.
  if (scope) byCol[scope.column] = scope.values;
  for (const node of path) {
    // Skip columns that don't exist yet — they can't filter the table.
    if (graphColIdx(node.filter.column) === -1) continue;
    byCol[node.filter.column] = node.filter.values;
  }
  return byCol;
}

// ---------------------------------------------------------------------------
// The view: everything the sidebar, flow diagram and table need for one set of
// filters. One pass shares the base row sets that the old per-memo code rebuilt
// from scratch for every aggregate.
// ---------------------------------------------------------------------------

export interface ViewQuery {
  columnFilters: Record<string, string>;
  multiFilters: Record<string, string[]>;
  batchFilters: Record<string, boolean>;
  dateRanges: DateRanges;
  globalSearch: string;
  balBillFilter: BalBillFilter;
  statusFilter: string;
  tileItems: string[];
  tileSize: string;
  activeRateTile: RateTileKey | null;
  /**
   * The table's "Drawing present" / "Image present" checkboxes. They narrow the
   * rows the table shows but, as in the client pipeline, not the aggregates.
   */
  presence: { drawing: boolean; image: boolean };
}

export interface ViewContext {
  headers: string[];
  rows: unknown[][];
  /** Whether an item code has images (for the "Image present" checkbox). */
  hasImage?: (itemCode: string) => boolean;
  /** BOM ID category per row object (see matchesTableFilters). */
  bomCategoryByRow: WeakMap<unknown[], BomIdCategory>;
  trees: ReturnType<typeof enabledTrees>;
  batchPresenceFilters: { key: string; column: string; value: string }[];
}

export interface ContractNoMeta {
  count: number;
  sum: number;
  partyName: string;
}

export interface ContractReviewView {
  statusCounts: Record<string, number>;
  statusOptions: string[];
  clearanceCounts: Record<string, number>;
  clearanceOptions: string[];
  mcCounts: Record<string, number>;
  mcOptions: string[];
  inspectionCounts: Record<string, number>;
  inspectionOptions: string[];
  itemOptions: TileOption[];
  sizeOptions: TileOption[];
  pnOptions: TileOption[];
  rateMcCont: Aggregate;
  rateOrderQty: Aggregate;
  rateBalBillCont: Aggregate;
  rateBalDiQty: Aggregate;
  rateBalMspQty: Aggregate;
  balBillAgContTotal: Aggregate;
  totalCostExcGst: Aggregate;
  totalCostIncGst: Aggregate;
  totalVaPct: Aggregate;
  /** Rows passing every filter (table + sidebar + rate tile). */
  tileRowsCount: number;
  contractCount: number;
  tileAllCounts: {
    item: number;
    itemBalBill: number;
    size: number;
    pn: number;
  };
  graphCounts: Record<string, number>;
  graphValues: Record<string, string>;
  contractNoMeta: Record<string, ContractNoMeta>;
}

export interface ViewResult {
  view: ContractReviewView;
  /** Rows passing every filter, in data order. */
  matchedIdx: number[];
  /**
   * Rows passing the sidebar + rate tile only (what the page hands a table that
   * still filters client-side). Only filled when `wantVisible` is set.
   */
  visibleIdx: number[];
}

const GRAPH_PATH_COLUMNS = new Set(["STATUS", "CLEARANCE STATUS"]);

const byNumericLocale = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

function withBlankLast(
  counts: Record<string, number>,
  selected: string[],
): string[] {
  const keys = Object.keys(counts).filter((k) => k !== "all");
  // Always include (Blank) like table column filter does, even if count 0.
  if (!keys.includes("(Blank)")) keys.push("(Blank)");
  // Keep selected values visible even if count 0 (bidirectional cascading).
  for (const s of selected) {
    if (s !== "(Blank)" && !keys.includes(s)) keys.push(s);
  }
  return keys.sort((a, b) => {
    if (a === "(Blank)") return 1;
    if (b === "(Blank)") return -1;
    return byNumericLocale(a, b);
  });
}

export function computeView(
  ctx: ViewContext,
  q: ViewQuery,
  opts: { wantVisible?: boolean } = {},
): ViewResult {
  const { headers, rows, bomCategoryByRow, trees, batchPresenceFilters } = ctx;
  const {
    columnFilters,
    multiFilters,
    batchFilters,
    dateRanges,
    globalSearch,
    balBillFilter,
    statusFilter,
    tileItems,
    tileSize,
    activeRateTile,
  } = q;

  const balBillIdx = headers.indexOf("BAL BILL AG CONT");
  const effectiveBalBillIdx =
    balBillIdx !== -1 ? balBillIdx : BAL_BILL_AG_CONT_IDX;
  const clearanceIdx = headers.indexOf("CLEARANCE STATUS");
  const partyNameIdx = headers.indexOf("PARTY NAME");

  const clearanceFilter = multiFilters["CLEARANCE STATUS"] ?? [];
  const tilePns = multiFilters["PN RATING"] ?? [];
  const mcFilter = multiFilters["MC Received/Pending"] ?? [];
  const inspectionFilter = multiFilters["Inspection"] ?? [];

  // Batch presence filters (C / N) cascade through every aggregate because they
  // all route through rowOk.
  const activeBatch = batchPresenceFilters
    .filter((bf) => batchFilters[bf.key])
    .map((bf) => ({ idx: headers.indexOf(bf.column), value: bf.value }));

  const rowOk = (
    row: unknown[],
    excludeHeader?: string,
    ignoreColumns?: Set<string>,
  ): boolean => {
    if (
      !matchesTableFilters(
        row,
        headers,
        columnFilters,
        multiFilters,
        globalSearch,
        dateRanges,
        excludeHeader,
        ignoreColumns,
        bomCategoryByRow,
      )
    )
      return false;
    for (const b of activeBatch) {
      if (b.idx === -1 || String(row[b.idx] ?? "").trim() !== b.value)
        return false;
    }
    return true;
  };

  const sb = (row: unknown[], exclude?: SidebarExclude) =>
    matchesSidebar(
      row,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItems,
      tileSize,
      tilePns,
      mcFilter,
      inspectionFilter,
      balBillIdx,
      clearanceIdx,
      MC_IDX,
      INSPECTION_IDX,
      exclude,
    );

  // Row indexes passing the table filters (minus one column) and the rate tile.
  const baseCache = new Map<string, number[]>();
  const baseFor = (
    key: string,
    excludeHeader?: string,
    ignoreColumns?: Set<string>,
  ): number[] => {
    let idx = baseCache.get(key);
    if (!idx) {
      idx = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (rowOk(row, excludeHeader, ignoreColumns) && matchesRateTile(row, activeRateTile))
          idx.push(i);
      }
      baseCache.set(key, idx);
    }
    return idx;
  };

  const sidebarBase = baseFor("sidebar");

  // Rows passing the table filters AND the sidebar: what the table shows.
  const matchedIdx = sidebarBase.filter((i) => sb(rows[i]));

  // --- STATUS -------------------------------------------------------------
  const statusCounts: Record<string, number> = { all: 0 };
  for (const i of sidebarBase) {
    const row = rows[i];
    if (!sb(row, "status")) continue;
    statusCounts.all++;
    const cell = String(row[STATUS_IDX] ?? "").trim();
    const key = cell === "" ? "Blanks" : statusTitle(cell);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  const statusOptions = Object.keys(statusCounts)
    .filter((k) => k !== "all")
    .sort((a, b) =>
      a === "Blanks" ? -1 : b === "Blanks" ? 1 : byNumericLocale(a, b),
    );

  // --- Cascading multi-selects (exclude-self) -------------------------------
  const cascade = (
    header: string,
    exclude: SidebarExclude,
    colIdx: number,
  ): Record<string, number> => {
    const counts: Record<string, number> = { all: 0 };
    for (const i of baseFor(`col:${header}`, header)) {
      const row = rows[i];
      if (!sb(row, exclude)) continue;
      counts.all++;
      const cell = String(row[colIdx] ?? "").trim();
      const key = cell === "" ? "(Blank)" : cell;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  const clearanceCounts = cascade("CLEARANCE STATUS", "clearance", clearanceIdx);
  const clearanceOptions = withBlankLast(clearanceCounts, clearanceFilter);
  const mcCounts = cascade("MC Received/Pending", "mc", MC_IDX);
  const mcOptions = withBlankLast(mcCounts, mcFilter);
  const inspectionCounts = cascade("Inspection", "inspection", INSPECTION_IDX);
  const inspectionOptions = withBlankLast(inspectionCounts, inspectionFilter);

  // --- Item ------------------------------------------------------------------
  const itemOptions = groupItemBalBill(
    rows,
    baseFor("col:Item", "Item"),
    ITEM_IDX,
    effectiveBalBillIdx,
    (row) => sb(row, "item"),
  );
  for (const s of tileItems) {
    if (!itemOptions.some((o) => o.value === s))
      itemOptions.push({ value: s, count: 0, sum: 0 });
  }
  if (!itemOptions.some((o) => o.value === EXTRA_ITEM_OPTION))
    itemOptions.push({ value: EXTRA_ITEM_OPTION, count: 0, sum: 0 });
  itemOptions.sort((a, b) => byNumericLocale(a.value, b.value));

  // --- Size ------------------------------------------------------------------
  const sizeOptions = groupCount(rows, sidebarBase, SIZE_IDX, (row) =>
    sb(row, "size"),
  );

  // --- PN rating -------------------------------------------------------------
  const pnCounts: Record<string, number> = {};
  for (const i of baseFor("col:PN RATING", "PN RATING")) {
    const row = rows[i];
    if (!sb(row, "pn")) continue;
    const cell = String(row[PN_IDX] ?? "").trim();
    const key = cell === "" ? "(Blank)" : cell;
    pnCounts[key] = (pnCounts[key] ?? 0) + 1;
  }
  const pnOptions: TileOption[] = Object.entries(pnCounts).map(
    ([value, count]) => ({ value, count }),
  );
  if (!pnOptions.some((o) => o.value === "(Blank)"))
    pnOptions.push({ value: "(Blank)", count: 0 });
  for (const s of tilePns) {
    if (s !== "(Blank)" && !pnOptions.some((o) => o.value === s))
      pnOptions.push({ value: s, count: 0 });
  }
  pnOptions.sort((a, b) => {
    if (a.value === "(Blank)") return 1;
    if (b.value === "(Blank)") return -1;
    return byNumericLocale(a.value, b.value);
  });

  // --- Tiles (sums over the rows the table shows) ------------------------------
  const sum = (
    pick: (row: unknown[]) => number | null,
  ): Aggregate => {
    let total = 0;
    let count = 0;
    for (const i of matchedIdx) {
      const v = pick(rows[i]);
      if (v === null) continue;
      total += v;
      count++;
    }
    return { sum: total, count };
  };

  const rateTile = (rateIdx: number, qtyIdx: number, subIdx?: number) =>
    sum((row) => {
      const rate = parseNum(row[rateIdx]);
      const qty = parseNum(row[qtyIdx]);
      if (subIdx !== undefined) {
        const sub = parseNum(row[subIdx]);
        if (isNaN(rate) || isNaN(qty) || isNaN(sub)) return null;
        return rate * (qty - sub);
      }
      if (isNaN(rate) || isNaN(qty)) return null;
      return rate * qty;
    });

  const rateMcCont = sum((row) => {
    const rate = parseFloat(String(row[RATE_IDX] ?? "").replace(/,/g, ""));
    const qty = parseFloat(String(row[MC_QTY_IDX] ?? "").replace(/,/g, ""));
    return isNaN(rate) || isNaN(qty) ? null : rate * qty;
  });
  const single = (idx: number, factor = 1) =>
    sum((row) => {
      const v = parseNum(row[idx]);
      return isNaN(v) ? null : v * factor;
    });

  const contracts = new Set<string>();
  for (const i of matchedIdx) {
    const cn = String(rows[i][CONTRACT_NO_IDX] ?? "").trim();
    if (cn) contracts.add(cn);
  }

  let tileAllItem = 0;
  let tileAllItemBalBill = 0;
  let tileAllSize = 0;
  let tileAllPn = 0;
  for (const i of sidebarBase) {
    const row = rows[i];
    if (sb(row, "item")) {
      tileAllItem++;
      const v = parseNum(row[effectiveBalBillIdx]);
      tileAllItemBalBill += isNaN(v) ? 0 : v;
    }
    if (sb(row, "size")) tileAllSize++;
    if (sb(row, "pn")) tileAllPn++;
  }

  // --- Flow diagram ------------------------------------------------------------
  // Respects every active filter except the graph's own columns (STATUS /
  // CLEARANCE STATUS), so selecting one branch never collapses sibling counts.
  // A node's rows are its parent's rows narrowed by the node's own filter, so
  // each level only walks the survivors of the level above.
  const graphBase = baseFor("graph", undefined, GRAPH_PATH_COLUMNS);
  const graphCounts: Record<string, number> = {};
  const graphValues: Record<string, string> = {};
  const walk = (node: FlowNode, inIdx: number[]) => {
    const out = inIdx.filter((i) => matchesGraphFilter(rows[i], node.filter));
    graphCounts[node.id] = out.length;
    if (node.metric === "diBalance") {
      let total = 0;
      for (const i of out) {
        const row = rows[i];
        const rate = parseNum(row[RATE_IDX]);
        const di = parseNum(row[DI_QTY_IDX]);
        const billed = parseNum(row[BILLED_QTY_IDX]);
        if (isNaN(rate) || isNaN(di) || isNaN(billed)) continue;
        total += rate * (di - billed);
      }
      graphValues[node.id] = fmt(total);
    }
    for (const kid of node.children ?? []) walk(kid, out);
  };
  for (const { tree, scope } of trees) {
    const scoped = scope
      ? graphBase.filter((i) => matchesScope(rows[i], scope))
      : graphBase;
    walk(tree, scoped);
  }

  // --- CONTRACT NO option metadata ---------------------------------------------
  const contractNoMeta: Record<string, ContractNoMeta> = {};
  for (const i of baseFor("col:CONTRACT NO", "CONTRACT NO")) {
    const row = rows[i];
    if (!sb(row)) continue;
    const cn = String(row[CONTRACT_NO_IDX] ?? "").trim();
    if (!cn) continue;
    const e =
      contractNoMeta[cn] ??
      (contractNoMeta[cn] = { count: 0, sum: 0, partyName: "" });
    e.count++;
    const rate = parseNum(row[RATE_IDX]);
    const bal = parseNum(row[BAL_BILL_AG_CONT_IDX]);
    if (!isNaN(rate) && !isNaN(bal)) e.sum += rate * bal;
    if (!e.partyName) e.partyName = String(row[partyNameIdx] ?? "").trim();
  }

  const visibleIdx: number[] = [];
  if (opts.wantVisible) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (sb(row) && matchesRateTile(row, activeRateTile)) visibleIdx.push(i);
    }
  }

  return {
    view: {
      statusCounts,
      statusOptions,
      clearanceCounts,
      clearanceOptions,
      mcCounts,
      mcOptions,
      inspectionCounts,
      inspectionOptions,
      itemOptions,
      sizeOptions,
      pnOptions,
      rateMcCont,
      rateOrderQty: rateTile(RATE_IDX, ORDER_QTY_IDX),
      rateBalBillCont: rateTile(RATE_IDX, BAL_BILL_AG_CONT_IDX),
      rateBalDiQty: rateTile(RATE_IDX, DI_QTY_IDX, BILLED_QTY_IDX),
      rateBalMspQty: rateTile(RATE_IDX, MC_QTY_IDX, DI_QTY_IDX),
      balBillAgContTotal: single(BAL_BILL_AG_CONT_IDX),
      totalCostExcGst: single(COST_FROM_QUOTATION_IDX),
      totalCostIncGst: single(COST_FROM_QUOTATION_IDX, 1.18),
      totalVaPct: single(VA_PCT_FROM_COST_IDX),
      tileRowsCount: matchedIdx.length,
      contractCount: contracts.size,
      tileAllCounts: {
        item: tileAllItem,
        itemBalBill: tileAllItemBalBill,
        size: tileAllSize,
        pn: tileAllPn,
      },
      graphCounts,
      graphValues,
      contractNoMeta,
    },
    matchedIdx,
    visibleIdx,
  };
}

/** Narrows row indexes by the table's own presence checkboxes. */
export function applyPresence(
  ctx: ViewContext,
  idx: number[],
  presence: ViewQuery["presence"],
): number[] {
  if (!presence.drawing && !presence.image) return idx;
  const drawingIdx = ctx.headers.indexOf(UPLOAD_DRAWING_COLUMN);
  const codeIdx = ctx.headers.indexOf("ITEM_CODE");
  return idx.filter((i) => {
    const row = ctx.rows[i];
    if (presence.drawing) {
      if (drawingIdx === -1 || !String(row[drawingIdx] ?? "").trim())
        return false;
    }
    if (presence.image) {
      const code = codeIdx !== -1 ? String(row[codeIdx] ?? "").trim() : "";
      if (!code || !ctx.hasImage?.(code)) return false;
    }
    return true;
  });
}

/** Distinct Item / CLEARANCE STATUS / PN RATING values over every row. */
export function buildCategoryOptions(
  rows: unknown[][],
  clearanceIdx: number,
): Record<string, string[]> {
  const distinct = (idx: number, extra?: string) => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = String(r[idx] ?? "").trim();
      if (v) set.add(v);
    }
    if (extra) set.add(extra);
    return [...set].sort(byNumericLocale);
  };
  const result: Record<string, string[]> = {};
  const items = distinct(ITEM_IDX, EXTRA_ITEM_OPTION);
  if (items.length) result.Item = items;
  result["CLEARANCE STATUS"] = distinct(clearanceIdx);
  result["PN RATING"] = distinct(PN_IDX);
  return result;
}

const SIDEBAR_EXCLUDE_BY_HEADER: Record<string, SidebarExclude> = {
  STATUS: "status",
  "CLEARANCE STATUS": "clearance",
  Item: "item",
  SIZE: "size",
  "PN RATING": "pn",
  "MC Received/Pending": "mc",
  Inspection: "inspection",
};

/**
 * Distinct values for one column's filter dropdown, cascaded: every active
 * filter applies except the column's own (so options never collapse under its
 * own selection).
 */
export function computeFacet(
  ctx: ViewContext,
  q: ViewQuery,
  header: string,
  limit = 1000,
): string[] {
  const colIdx = ctx.headers.indexOf(header);
  if (colIdx === -1) return [];
  const balBillIdx = ctx.headers.indexOf("BAL BILL AG CONT");
  const clearanceIdx = ctx.headers.indexOf("CLEARANCE STATUS");
  const exclude = SIDEBAR_EXCLUDE_BY_HEADER[header];
  const clearanceFilter = q.multiFilters["CLEARANCE STATUS"] ?? [];
  const activeBatch = ctx.batchPresenceFilters
    .filter((bf) => q.batchFilters[bf.key])
    .map((bf) => ({ idx: ctx.headers.indexOf(bf.column), value: bf.value }));
  const out = new Set<string>();
  for (const row of ctx.rows) {
    if (
      !matchesTableFilters(
        row,
        ctx.headers,
        q.columnFilters,
        q.multiFilters,
        q.globalSearch,
        q.dateRanges,
        header,
        undefined,
        ctx.bomCategoryByRow,
      )
    )
      continue;
    if (activeBatch.some((b) => b.idx === -1 || String(row[b.idx] ?? "").trim() !== b.value))
      continue;
    if (!matchesRateTile(row, q.activeRateTile)) continue;
    if (
      !matchesSidebar(
        row,
        q.balBillFilter,
        q.statusFilter,
        clearanceFilter,
        q.tileItems,
        q.tileSize,
        q.multiFilters["PN RATING"] ?? [],
        q.multiFilters["MC Received/Pending"] ?? [],
        q.multiFilters["Inspection"] ?? [],
        balBillIdx,
        clearanceIdx,
        MC_IDX,
        INSPECTION_IDX,
        exclude,
      )
    )
      continue;
    const v = String(row[colIdx] ?? "").trim();
    if (v) out.add(v);
  }
  return [...out].sort(byNumericLocale).slice(0, limit);
}

export interface SortSpec {
  header: string;
  direction: "asc" | "desc";
}

/**
 * Orders row indexes the way GMDUpdateTable (`sortByType`) orders rows, ties
 * falling back to data order. Returns `idx` untouched when there is no sort.
 */
export function sortRowIndexes(
  rows: unknown[][],
  idx: number[],
  headers: string[],
  sort: SortSpec | null,
): number[] {
  if (!sort) return idx;
  const col = headers.indexOf(sort.header);
  if (col === -1) return idx;
  const dir = sort.direction === "asc" ? 1 : -1;
  const isDate = isDateHeader(sort.header);
  return [...idx].sort((a, b) => {
    const c = isDate
      ? compareDates(rows[a][col], rows[b][col], dir)
      : cellCompare(rows[a][col], rows[b][col], dir, true);
    return c !== 0 ? c : a - b;
  });
}
