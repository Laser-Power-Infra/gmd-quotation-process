import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import { squish } from "@gmd/ui/lib/squish";
import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import { applyTable, facetValues } from "./ui/localTable";
import type { ActionResult, Basis, ContractLine, LineAllocation, LineStatus, OfferLine } from "./types";

// Ready to Bill: the engine's Offer Now lines (stock held against an order line, actuator included)
// as one server-paged table. Every per-column rule lives here; the server and the page read the same list.

export const READY_STAGES = ["Not offered", "Offered", "Inspection done"] as const;
export type ReadyStage = (typeof READY_STAGES)[number];
/** Engine statuses with a tile: ready for an inspection call, and (its own count) held but needing an actuator wiring change. */
export const CALL_STATUSES = ["Ready for inspection call", "Allocated - wiring change required"] as const satisfies readonly LineStatus[];
export type CallStatus = (typeof CALL_STATUSES)[number];

export interface ReadyToBillRow {
  id: string; contractNo: string; party: string; poNo: string | null;
  /** Contract date as yyyy-mm-dd; null when unreadable. */
  date: string | null;
  mcNo: string | null;
  itemCode: string; itemName: string; partyItemName: string | null; actuator: string | null; stage: ReadyStage;
  /** The engine's status for the line (LineAllocation.status); the per-line figures below are null when it has none. */
  allocStatus: LineStatus | null;
  balanceQty: number; balanceToOffer: number | null; readyQty: number; shortfall: number | null;
  /** China shipments covering the shortfall (null when none); ETA as yyyy-mm-dd, or as written when not a date. */
  incomingQty: number | null; eta: string | null;
  rate: number; readyValue: number;
  /** RM codes held for the line (valve, actuator, spares). */
  stock: string; basis: string; flags: string; project: string | null;
}

export interface ReadyToBillMeta {
  /** Over every line matching the query, not just the page. */
  value: number; parties: number; contracts: number;
  /** Per stage under every filter but the stage one, so a stage tile keeps its figure once picked. */
  stages: Record<ReadyStage, { value: number; lines: number }>;
  /** Per call status under every filter but the status one, likewise. */
  calls: Record<CallStatus, { value: number; lines: number }>;
}
export type ReadyToBillPageData = TablePage<ReadyToBillRow, ReadyToBillMeta>;
/** Download rows, cells in the order of their header. */
export type ExportRows = (string | number | null)[][];

/** Server Actions the host app supplies; the app owns auth. */
export interface ReadyToBillActions {
  loadPage(query: TableQuery): Promise<ActionResult<ReadyToBillPageData>>;
  loadFacet(key: string, query: TableQuery): Promise<ActionResult<string[]>>;
  /** readyToBillExport rows (READY_COLUMNS order) for the query. */
  loadExport(query: TableQuery): Promise<ActionResult<ExportRows>>;
  /** inspectionCallList rows (SHARE_HEADER order) for the query. */
  loadShareList(query: TableQuery): Promise<ActionResult<ExportRows>>;
}

export const READY_COLUMNS: DataColumn<ReadyToBillRow>[] = [
  { key: "contractNo", label: "Contract", kind: "text", sticky: true, width: 130, filter: true, sortable: true },
  { key: "party", label: "Party", kind: "text", width: 220, filter: true, sortable: true },
  { key: "poNo", label: "PO no", kind: "text", width: 140, sortable: true },
  { key: "date", label: "Contract date", kind: "date", width: 120, sortable: true },
  { key: "mcNo", label: "MC no", kind: "text", width: 130, filter: true, sortable: true },
  { key: "itemCode", label: "Item code", kind: "text", width: 130, filter: true, sortable: true },
  { key: "itemName", label: "Item", kind: "text", width: 280, sortable: true },
  { key: "actuator", label: "Actuator", kind: "text", width: 200, filter: true, sortable: true },
  { key: "stage", label: "Stage", kind: "text", width: 130, filter: true, sortable: true },
  { key: "allocStatus", label: "Alloc status", kind: "text", width: 240, filter: true, sortable: true },
  { key: "balanceQty", label: "Balance qty", kind: "number", align: "right", width: 110, sortable: true },
  { key: "balanceToOffer", label: "Balance to offer", kind: "number", align: "right", width: 120, sortable: true },
  { key: "readyQty", label: "Ready qty", kind: "number", align: "right", width: 100, sortable: true },
  { key: "shortfall", label: "Shortfall", kind: "number", align: "right", width: 100, sortable: true },
  { key: "incomingQty", label: "Incoming", kind: "number", align: "right", width: 100, sortable: true },
  { key: "eta", label: "ETA", kind: "date", width: 110, sortable: true },
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

/**
 * Biggest ready value first (then line id, so pages stay stable): the order before any sort. `lines` is the engine's
 * per-line result; a line it does not cover keeps those cells blank.
 */
function rowsOf(offerNow: OfferLine[], lines: LineAllocation[]): ReadyToBillRow[] {
  const byId = new Map(lines.map((a) => [a.id, a]));
  return offerNow
    .filter((o) => o.offerableQty > 0) // Offer Now also lists locked lines at 0 so they can be unlocked
    .map(({ line: l, ...o }) => {
      const a = byId.get(l.id);
      return {
        id: l.id, contractNo: l.contractNo, party: l.party, poNo: l.poNo, date: isoDate(parseGmdDate(l.dateOfContract)),
        mcNo: l.mcNo ?? null, itemCode: l.itemCode, itemName: l.itemName, partyItemName: l.partyItemName?.trim() || null, actuator: l.actuator?.trim() || null, stage: stageOf(l),
        allocStatus: a?.status ?? null, balanceQty: l.balanceQty, balanceToOffer: a?.balanceToOffer ?? null, readyQty: o.offerableQty,
        shortfall: a?.shortfall ?? null, incomingQty: a?.incomingQty || null, eta: isoDate(parseGmdDate(a?.eta)) ?? (a?.eta || null),
        rate: l.rate, readyValue: o.offerValue,
        stock: o.rmCodes.map(rmText).join("; "), basis: basisText(o.basis), flags: o.flags.join(", "), project: l.project,
      };
    })
    .sort((a, b) => b.readyValue - a.readyValue || a.id.localeCompare(b.id));
}

/** Rows matching the search and every filter column's selection except `skip`'s. */
function narrow(rows: ReadyToBillRow[], query: TableQuery, skip?: string): ReadyToBillRow[] {
  const needle = squish(query.search);
  const searched = needle ? rows.filter((r) => squish(TEXT.map((k) => r[k]).join(" ")).includes(needle)) : rows;
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== skip && FILTERS.has(k)));
  return applyTable(searched, READY_COLUMNS, null, filters);
}

/** Every row the query keeps, in its sort order (unknown sort keys keep the default order). */
function kept(rows: ReadyToBillRow[], query: TableQuery): ReadyToBillRow[] {
  const sort = READY_COLUMNS.some((c) => c.sortable && c.key === query.sort?.key) ? query.sort : null;
  return applyTable(narrow(rows, query), READY_COLUMNS, sort, {});
}

/** Value and line count per tile value, over `rows`. */
function tally<K extends string>(values: readonly K[], rows: ReadyToBillRow[], of: (r: ReadyToBillRow) => string | null) {
  return Object.fromEntries(values.map((v) => {
    const mine = rows.filter((r) => of(r) === v);
    return [v, { value: mine.reduce((s, r) => s + r.readyValue, 0), lines: mine.length }];
  })) as Record<K, { value: number; lines: number }>;
}

export function readyToBillPage(offerNow: OfferLine[], query: TableQuery, lines: LineAllocation[] = []): ReadyToBillPageData {
  const rows = rowsOf(offerNow, lines);
  const all = kept(rows, query);
  const size = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const start = (Math.max(1, query.page) - 1) * size;
  return {
    rows: all.slice(start, start + size),
    total: all.length,
    meta: {
      value: all.reduce((s, r) => s + r.readyValue, 0),
      parties: new Set(all.map((r) => r.party)).size,
      contracts: new Set(all.map((r) => r.contractNo)).size,
      stages: tally(READY_STAGES, narrow(rows, query, "stage"), (r) => r.stage),
      calls: tally(CALL_STATUSES, narrow(rows, query, "allocStatus"), (r) => r.allocStatus),
    },
  };
}

/** Distinct values of one filter column under every other active filter. */
export function readyToBillFacet(offerNow: OfferLine[], key: string, query: TableQuery, lines: LineAllocation[] = []): string[] {
  return FILTERS.has(key) ? facetValues(narrow(rowsOf(offerNow, lines), query, key), key) : [];
}

/** The internal download: every line the query keeps (not one page), in its sort order, cells in READY_COLUMNS order. */
export function readyToBillExport(offerNow: OfferLine[], query: TableQuery, lines: LineAllocation[]): ExportRows {
  return kept(rowsOf(offerNow, lines), query).map((r) => READY_COLUMNS.map((c) => r[c.key as keyof ReadyToBillRow]));
}

/** Keeps a string that starts like a spreadsheet formula as text. The sharing list leaves the company and its names come from synced sheets. Numbers pass untouched. */
const textOnly = <T,>(v: T): T | string => (typeof v === "string" && /^\s*[=+\-@]/.test(v) ? `'${v}` : v);

export const SHARE_HEADER = ["Party", "Contract no", "MC no", "Item", "Make", "Qty ready"];

/**
 * The inspection call list, safe to send outside: the lines the query keeps whose status is "Ready for inspection call",
 * party → contract → MC no. Whitelisted customer-facing cells only (the contract's item name, make DALUI): never an RM
 * code, stock location, supplier / import text, incoming qty or ETA. Qty ready is the balance to offer, which finished
 * stock covers whole on a ready line; "Ready qty" would add qty already offered and not yet billed.
 */
export function inspectionCallList(offerNow: OfferLine[], query: TableQuery, lines: LineAllocation[]): ExportRows {
  return narrow(rowsOf(offerNow, lines), query)
    .filter((r) => r.allocStatus === "Ready for inspection call")
    .sort((a, b) => a.party.localeCompare(b.party) || a.contractNo.localeCompare(b.contractNo) || (a.mcNo ?? "").localeCompare(b.mcNo ?? ""))
    .map((r) => [r.party, r.contractNo, r.mcNo, r.partyItemName || r.itemName, "DALUI", r.balanceToOffer].map(textOnly));
}
