import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import { squish } from "@gmd/ui/lib/squish";
import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import { applyTable, facetValues } from "./ui/localTable";
import type { ActionResult, Basis, ContractLine, OfferLine } from "./types";

// Ready to Bill: the engine's Offer Now lines (stock held against an order line, actuator included)
// as one server-paged table. Every per-column rule lives here; the server and the page read the same list.

export const READY_STAGES = ["Not offered", "Offered", "Inspection done"] as const;
export type ReadyStage = (typeof READY_STAGES)[number];

export interface ReadyToBillRow {
  id: string; contractNo: string; party: string; poNo: string | null;
  /** Contract date as yyyy-mm-dd; null when unreadable. */
  date: string | null;
  itemCode: string; itemName: string; actuator: string | null; stage: ReadyStage;
  balanceQty: number; readyQty: number; rate: number; readyValue: number;
  /** RM codes held for the line (valve, actuator, spares). */
  stock: string; basis: string; flags: string; project: string | null;
}

export interface ReadyToBillMeta {
  /** Over every line matching the query, not just the page. */
  value: number; parties: number; contracts: number;
  /** Per stage under every filter but the stage one, so a stage tile keeps its figure once picked. */
  stages: Record<ReadyStage, { value: number; lines: number }>;
}
export type ReadyToBillPageData = TablePage<ReadyToBillRow, ReadyToBillMeta>;

/** Server Actions the host app supplies; the app owns auth. */
export interface ReadyToBillActions {
  loadPage(query: TableQuery): Promise<ActionResult<ReadyToBillPageData>>;
  loadFacet(key: string, query: TableQuery): Promise<ActionResult<string[]>>;
}

export const READY_COLUMNS: DataColumn<ReadyToBillRow>[] = [
  { key: "contractNo", label: "Contract", kind: "text", sticky: true, width: 130, filter: true, sortable: true },
  { key: "party", label: "Party", kind: "text", width: 220, filter: true, sortable: true },
  { key: "poNo", label: "PO no", kind: "text", width: 140, sortable: true },
  { key: "date", label: "Contract date", kind: "date", width: 120, sortable: true },
  { key: "itemCode", label: "Item code", kind: "text", width: 130, filter: true, sortable: true },
  { key: "itemName", label: "Item", kind: "text", width: 280, sortable: true },
  { key: "actuator", label: "Actuator", kind: "text", width: 200, filter: true, sortable: true },
  { key: "stage", label: "Stage", kind: "text", width: 130, filter: true, sortable: true },
  { key: "balanceQty", label: "Balance qty", kind: "number", align: "right", width: 110, sortable: true },
  { key: "readyQty", label: "Ready qty", kind: "number", align: "right", width: 100, sortable: true },
  { key: "rate", label: "Rate", kind: "number", align: "right", width: 110, sortable: true },
  { key: "readyValue", label: "Ready value", kind: "number", align: "right", width: 130, sortable: true },
  { key: "stock", label: "Stock held (RM codes)", kind: "text", width: 280 },
  { key: "basis", label: "Basis", kind: "text", width: 130, filter: true, sortable: true },
  { key: "flags", label: "Flags", kind: "text", width: 200, filter: true },
  { key: "project", label: "Project", kind: "text", width: 160, filter: true, sortable: true },
];

const MAX_PAGE_SIZE = 200;
const FILTERS = new Set(READY_COLUMNS.filter((c) => c.filter).map((c) => c.key));
const TEXT = READY_COLUMNS.filter((c) => c.kind === "text").map((c) => c.key as keyof ReadyToBillRow);

/** "FSD040050 @KGP ×2 (spare)": one RM code held for a line. */
export const rmText = (r: OfferLine["rmCodes"][number]) => `${r.erpCode}${r.location ? ` @${r.location}` : ""} ×${r.qty}${r.spare ? " (spare)" : ""}`;
/** A basis as shown: the actuator is held now, but locked ledger rows keep the stored "Actuator to map". */
export const basisText = (b: Basis) => (b === "Actuator to map" ? "With actuator" : b);
const stageOf = (l: ContractLine): ReadyStage => (l.inspection === "DONE" ? "Inspection done" : l.offer === "DONE" ? "Offered" : "Not offered");
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date | null) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);

/** Biggest ready value first (then line id, so pages stay stable): the order before any sort. */
function rowsOf(offerNow: OfferLine[]): ReadyToBillRow[] {
  return offerNow
    .filter((o) => o.offerableQty > 0) // Offer Now also lists locked lines at 0 so they can be unlocked
    .map(({ line: l, ...o }) => ({
      id: l.id, contractNo: l.contractNo, party: l.party, poNo: l.poNo, date: isoDate(parseGmdDate(l.dateOfContract)),
      itemCode: l.itemCode, itemName: l.itemName, actuator: l.actuator?.trim() || null, stage: stageOf(l),
      balanceQty: l.balanceQty, readyQty: o.offerableQty, rate: l.rate, readyValue: o.offerValue,
      stock: o.rmCodes.map(rmText).join("; "), basis: basisText(o.basis), flags: o.flags.join(", "), project: l.project,
    }))
    .sort((a, b) => b.readyValue - a.readyValue || a.id.localeCompare(b.id));
}

/** Rows matching the search and every filter column's selection except `skip`'s. */
function narrow(rows: ReadyToBillRow[], query: TableQuery, skip?: string): ReadyToBillRow[] {
  const needle = squish(query.search);
  const searched = needle ? rows.filter((r) => squish(TEXT.map((k) => r[k]).join(" ")).includes(needle)) : rows;
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== skip && FILTERS.has(k)));
  return applyTable(searched, READY_COLUMNS, null, filters);
}

export function readyToBillPage(offerNow: OfferLine[], query: TableQuery): ReadyToBillPageData {
  const base = narrow(rowsOf(offerNow), query, "stage");
  const sort = READY_COLUMNS.some((c) => c.sortable && c.key === query.sort?.key) ? query.sort : null;
  const kept = applyTable(base, READY_COLUMNS, sort, { stage: query.filters.stage ?? [] });
  const size = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const start = (Math.max(1, query.page) - 1) * size;
  const stages = Object.fromEntries(READY_STAGES.map((s) => [s, { value: 0, lines: 0 }])) as ReadyToBillMeta["stages"];
  for (const r of base) {
    stages[r.stage].value += r.readyValue;
    stages[r.stage].lines++;
  }
  return {
    rows: kept.slice(start, start + size),
    total: kept.length,
    meta: {
      value: kept.reduce((s, r) => s + r.readyValue, 0),
      parties: new Set(kept.map((r) => r.party)).size,
      contracts: new Set(kept.map((r) => r.contractNo)).size,
      stages,
    },
  };
}

/** Distinct values of one filter column under every other active filter. */
export function readyToBillFacet(offerNow: OfferLine[], key: string, query: TableQuery): string[] {
  return FILTERS.has(key) ? facetValues(narrow(rowsOf(offerNow), query, key), key) : [];
}
