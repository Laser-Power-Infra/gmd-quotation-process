import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import { squish } from "@gmd/ui/lib/squish";
import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import { applyTable, facetValues } from "./ui/localTable";
import type { PurchaseLineView } from "./types";

// Purchase side of Stock Allocation, as two server-paged tables built the way Ready to Bill is (readyToBill.ts):
//  - "allocations": one row per purchase allocation (per-line sources: PO line, lot, invoice, B/L, ETA, qty, shortage, state);
//  - "lots": one row per purchase line (ordered, received, who holds it, free balance).
// Internal screens only: lot, Tina invoice, B/L, ETA and PO no never go into an offer or any list shared outside.

export type PurchaseViewKey = "allocations" | "lots";

/** The stored allocation fields the views read (PurchaseAllocation row, dates as ISO text). */
export interface AllocationRowIn {
  id: string; poNo: string; poLineNo: string; contractNo: string; itemCode: string; qty: number; lot: string | null;
  tinaInvoiceNo: string | null; blNo: string | null; eta: string | null; needsConfirmation: boolean; remarks: string | null;
  source: string; allocatedAt: string;
}

export interface AllocationViewRow {
  id: string; poNo: string; poLineNo: string; purchaseLine: string; contractNo: string; itemCode: string;
  lot: string | null; tinaInvoiceNo: string | null; blNo: string | null; eta: string | null;
  qty: number; received: number | null; incoming: number | null; shortage: number | null;
  /** "received", "incoming", "short" (joined by " + " when a line is split); blank when the engine has no view of the line. */
  state: string;
  /** "Needs confirmation" or blank. */
  confirm: string; source: string; remarks: string | null;
}
export interface LotViewRow {
  id: string; poNo: string; poLineNo: string; purchaseLine: string; itemCode: string;
  lot: string | null; tinaInvoiceNo: string | null; blNo: string | null; eta: string | null;
  ordered: number; received: number; allocatedQty: number; allocatedTo: string; freeBalance: number; confirm: string;
}
export type PurchaseViewRow = AllocationViewRow | LotViewRow;
export type PurchaseViewPage = TablePage<PurchaseViewRow>;

export const NEEDS_CONFIRMATION = "Needs confirmation";

/** The state words of one allocation's split: received (in stock), incoming (still on the way), short (line closed, not received). */
export function stateWords(p: { physicalQty: number; incomingQty: number; shortQty: number }): string {
  return [p.physicalQty > 0 && "received", p.incomingQty > 0 && "incoming", p.shortQty > 0 && "short"].filter(Boolean).join(" + ");
}

/** Prisma's unique-constraint error (poNo + poLineNo + contractNo + itemCode) as the sentence the user should read; anything else is unchanged. */
export function friendlyPurchaseError(err: unknown): Error {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "P2002") return new Error("This contract line is already allocated from this purchase line: edit its qty instead");
  return err instanceof Error ? err : new Error(String(err));
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOrText = (v: string | null) => {
  const d = parseGmdDate(v);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : v?.trim() || null;
};
const plo = (a: { poNo: string; poLineNo: string }) => `${a.poNo}/${a.poLineNo}`;

export const ALLOCATION_COLUMNS: DataColumn<AllocationViewRow>[] = [
  { key: "purchaseLine", label: "Purchase / PO line", kind: "text", sticky: true, width: 150, filter: true, sortable: true },
  { key: "contractNo", label: "Contract", kind: "text", width: 130, filter: true, sortable: true },
  { key: "itemCode", label: "Item code", kind: "text", width: 130, filter: true, sortable: true },
  { key: "lot", label: "Lot", kind: "text", width: 120, filter: true, sortable: true },
  { key: "tinaInvoiceNo", label: "Tina invoice no", kind: "text", width: 140, filter: true, sortable: true },
  { key: "blNo", label: "B/L", kind: "text", width: 130, filter: true, sortable: true },
  { key: "eta", label: "ETA", kind: "date", width: 110, sortable: true },
  { key: "qty", label: "Qty allocated", kind: "number", align: "right", width: 110, sortable: true },
  { key: "received", label: "Received", kind: "number", align: "right", width: 100, sortable: true },
  { key: "incoming", label: "Incoming", kind: "number", align: "right", width: 100, sortable: true },
  { key: "shortage", label: "Shortage", kind: "number", align: "right", width: 100, sortable: true },
  { key: "state", label: "State", kind: "text", width: 160, filter: true, sortable: true },
  { key: "confirm", label: "Confirmation", kind: "text", width: 160, filter: true, sortable: true },
  { key: "source", label: "Entered by", kind: "text", width: 100, filter: true, sortable: true },
  { key: "remarks", label: "Remarks", kind: "text", width: 200 },
];

export const LOT_COLUMNS: DataColumn<LotViewRow>[] = [
  { key: "purchaseLine", label: "Purchase / PO line", kind: "text", sticky: true, width: 150, filter: true, sortable: true },
  { key: "itemCode", label: "Item code", kind: "text", width: 130, filter: true, sortable: true },
  { key: "lot", label: "Lot", kind: "text", width: 140, filter: true, sortable: true },
  { key: "tinaInvoiceNo", label: "Tina invoice no", kind: "text", width: 150, filter: true, sortable: true },
  { key: "blNo", label: "B/L", kind: "text", width: 140, filter: true, sortable: true },
  { key: "eta", label: "ETA", kind: "date", width: 110, sortable: true },
  { key: "ordered", label: "Ordered", kind: "number", align: "right", width: 100, sortable: true },
  { key: "received", label: "Received", kind: "number", align: "right", width: 100, sortable: true },
  { key: "allocatedQty", label: "Allocated", kind: "number", align: "right", width: 100, sortable: true },
  { key: "allocatedTo", label: "Allocated to (contract / item × qty)", kind: "text", width: 340 },
  { key: "freeBalance", label: "Free balance", kind: "number", align: "right", width: 110, sortable: true },
  { key: "confirm", label: "Confirmation", kind: "text", width: 160, filter: true, sortable: true },
];

const MAX_PAGE_SIZE = 200;
const COLUMNS = { allocations: ALLOCATION_COLUMNS, lots: LOT_COLUMNS } as unknown as { [K in PurchaseViewKey]: DataColumn<PurchaseViewRow>[] };
export const isPurchaseView = (v: unknown): v is PurchaseViewKey => v === "allocations" || v === "lots";

const distinct = (xs: (string | null)[]) => [...new Set(xs.map((x) => x?.trim()).filter(Boolean))].join("; ") || null;

/** One row per stored allocation; its qty split comes from the engine's per-line view. Order: contract, then purchase line. */
export function allocationRows(allocs: AllocationRowIn[], views: PurchaseLineView[]): AllocationViewRow[] {
  const viewOf = new Map(views.map((v) => [plo(v), v]));
  return allocs
    .map((a): AllocationViewRow => {
      const mine = viewOf.get(plo(a))?.allocatedTo.filter((t) => t.contractNo === a.contractNo && t.itemCode === a.itemCode);
      const sum = (s: string) => (mine ?? []).filter((t) => t.state === s).reduce((n, t) => n + t.qty, 0);
      const [received, incoming, shortage] = mine ? [sum("received"), sum("incoming"), sum("short")] : [null, null, null];
      return {
        id: a.id, poNo: a.poNo, poLineNo: a.poLineNo, purchaseLine: plo(a), contractNo: a.contractNo, itemCode: a.itemCode,
        lot: a.lot, tinaInvoiceNo: a.tinaInvoiceNo, blNo: a.blNo, eta: isoOrText(a.eta), qty: a.qty,
        received, incoming, shortage,
        state: mine ? stateWords({ physicalQty: received!, incomingQty: incoming!, shortQty: shortage! }) : "",
        confirm: a.needsConfirmation ? NEEDS_CONFIRMATION : "", source: a.source, remarks: a.remarks,
      };
    })
    .sort((a, b) => a.contractNo.localeCompare(b.contractNo) || a.purchaseLine.localeCompare(b.purchaseLine) || a.id.localeCompare(b.id));
}

/** One row per purchase line the engine knows; lot, invoice, B/L and ETA are those of the allocations on the line (blank when none). */
export function lotRows(views: PurchaseLineView[], allocs: AllocationRowIn[]): LotViewRow[] {
  return views
    .map((v): LotViewRow => {
      const mine = allocs.filter((a) => a.poNo === v.poNo && a.poLineNo === v.poLineNo);
      const held = new Map<string, number>();
      for (const t of v.allocatedTo) held.set(`${t.contractNo} / ${t.itemCode}`, (held.get(`${t.contractNo} / ${t.itemCode}`) ?? 0) + t.qty);
      return {
        id: plo(v), poNo: v.poNo, poLineNo: v.poLineNo, purchaseLine: plo(v), itemCode: v.itemCode,
        lot: distinct(mine.map((a) => a.lot)), tinaInvoiceNo: distinct(mine.map((a) => a.tinaInvoiceNo)), blNo: distinct(mine.map((a) => a.blNo)),
        eta: distinct(mine.map((a) => isoOrText(a.eta))), ordered: v.ordered, received: v.received,
        allocatedQty: [...held.values()].reduce((s, q) => s + q, 0),
        allocatedTo: [...held].map(([k, q]) => `${k} ×${q}`).join("; "), freeBalance: v.freeBalance,
        confirm: mine.some((a) => a.needsConfirmation) ? NEEDS_CONFIRMATION : "",
      };
    })
    .sort((a, b) => a.poNo.localeCompare(b.poNo) || a.poLineNo.localeCompare(b.poLineNo, undefined, { numeric: true }));
}

function narrow(rows: PurchaseViewRow[], view: PurchaseViewKey, query: TableQuery, skip?: string): PurchaseViewRow[] {
  const cols = COLUMNS[view];
  const text = cols.filter((c) => c.kind === "text").map((c) => c.key);
  const needle = squish(query.search);
  const searched = needle ? rows.filter((r) => squish(text.map((k) => (r as unknown as Record<string, unknown>)[k] ?? "").join(" ")).includes(needle)) : rows;
  const allowed = new Set(cols.filter((c) => c.filter).map((c) => c.key));
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== skip && allowed.has(k)));
  return applyTable(searched, cols, null, filters);
}

/** One page of a view: search, filters and sort run over every row (unknown sort keys keep the default order); page size is capped. */
export function purchaseViewPage(view: PurchaseViewKey, rows: PurchaseViewRow[], query: TableQuery): PurchaseViewPage {
  const cols = COLUMNS[view];
  const sort = cols.some((c) => c.sortable && c.key === query.sort?.key) ? query.sort : null;
  const all = applyTable(narrow(rows, view, query), cols, sort, {});
  const size = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const start = (Math.max(1, query.page) - 1) * size;
  return { rows: all.slice(start, start + size), total: all.length };
}

/** Distinct values of one filter column under every other active filter. */
export function purchaseViewFacet(view: PurchaseViewKey, rows: PurchaseViewRow[], key: string, query: TableQuery): string[] {
  return COLUMNS[view].some((c) => c.filter && c.key === key) ? facetValues(narrow(rows, view, query, key), key) : [];
}

type Res<T> = { success: true; data: T } | { success: false; error: string };
/** Server Actions the host supplies for the two purchase tables; the app owns auth. */
export interface PurchaseViewActions {
  loadPurchaseViewPage(view: PurchaseViewKey, query: TableQuery): Promise<Res<PurchaseViewPage>>;
  loadPurchaseViewFacet(view: PurchaseViewKey, key: string, query: TableQuery): Promise<Res<string[]>>;
}
