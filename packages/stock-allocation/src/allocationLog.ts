import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import type { ActionResult } from "./types";

// Allocation log: one append-only row per ledger write (who, when, old → new qty).
// The row builder and the Log view's columns live here; the server and the view read the same file.

/** A StockAllocation row as the ledger stores it, before or after a write. */
type LedgerRow = {
  contractNo: string; itemCode: string; erpCode: string; location: string | null;
  qty: number; source: string; remarks: string | null;
};

/**
 * The StockAllocationLog row for one ledger write. `before` is null on a new booking or lock,
 * `after` is null when the row is removed; the action follows from that and the row's source.
 */
export function logRow(by: string | null | undefined, before: LedgerRow | null, after: LedgerRow | null) {
  const row = (after ?? before)!;
  const manual = row.source === "manual";
  return {
    by: by?.trim() || "unknown",
    action: before && after ? "change" : after ? (manual ? "book" : "lock") : manual ? "remove" : "unlock",
    contractNo: row.contractNo,
    itemCode: row.itemCode,
    erpCode: row.erpCode,
    location: row.location,
    oldQty: before?.qty ?? null,
    newQty: after?.qty ?? null,
    note: row.remarks,
  };
}

/** One log row as the Log view gets it; `at` is ISO. */
export interface AllocationLogRow {
  id: string; at: string; by: string; action: string; contractNo: string; itemCode: string;
  erpCode: string; location: string | null; oldQty: number | null; newQty: number | null; note: string | null;
}
export type AllocationLogPage = TablePage<AllocationLogRow>;

/** Server Action the host app supplies for the Log view; the app owns auth. */
export interface AllocationLogActions {
  loadLogPageAction(query: TableQuery): Promise<ActionResult<AllocationLogPage>>;
}

const qty = (v: number | null) => (v === null ? "–" : v.toLocaleString("en-IN"));

export const LOG_COLUMNS: DataColumn<AllocationLogRow>[] = [
  { key: "at", label: "When", kind: "date", sticky: true, width: 170, render: (r) => new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
  { key: "by", label: "Who", kind: "text", width: 200 },
  { key: "action", label: "Action", kind: "text", width: 90 },
  { key: "contractNo", label: "Contract", kind: "text", width: 130 },
  { key: "itemCode", label: "Item code", kind: "text", width: 130 },
  { key: "erpCode", label: "Stock code", kind: "text", width: 160, render: (r) => (r.location ? `${r.erpCode} @${r.location}` : r.erpCode) },
  { key: "qty", label: "Qty (old → new)", kind: "text", align: "right", width: 130, render: (r) => `${qty(r.oldQty)} → ${qty(r.newQty)}` },
  { key: "note", label: "Note", kind: "text", width: 260 },
];
