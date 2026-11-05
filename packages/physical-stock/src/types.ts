import type { CodeOptions } from "./codeOptions";
import type { TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import type { StockPageMeta } from "./server/query";

export interface PhysicalStockRow {
  id: string;
  /** ISO string; the server converts the DB Date. */
  form_date: string | null;
  erp_code: string | null;
  location: string | null;
  /** Derived from entries: every entry no of this row, oldest first, comma-joined. */
  entry_no: string | null;
  l2_valve_type: string | null;
  dimension: string | null;
  l7_dimension: string | null;
  l4_component: string | null;
  l5_material: string | null;
  l6_std: string | null;
  l8_item_category: string | null;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
  remarks: string | null;
  sum_of_physical_stock: string | null;
  stock_as_per_erp: string | null;
  item_wise_value: string | null;
  moving_within_3_months: string | null;
  order_ag_approval_recvd: string | null;
  purchase_in_26_27: string | null;
  dispatched_in_26_27: string | null;
  order_in_hand_qty: string | null;
  shortage_qty: string | null;
  unnamed_aa: string | null;
  item_type: string | null;
  price: string | null;
  moq: string | null;
  if_less_than_moq_extra_charges: string | null;
  drawing_technical_data: string | null;
  cost: string | null;
  bom_id: string | null;
  majorminor_marking: boolean | null;
  /** Derived (fgMatcher): FG code of a finished valve, or "NO BOM FG FOUND"; null for other items. */
  fg_item_code: string | null;
  /** Derived (fgMatcher): "PRODUCTION ITEM" for a finished valve with a BOM FG. */
  production_item: string | null;
  heat_done: boolean;
  /** Derived from heat_entries: distinct heat nos, comma-joined; null without entries. */
  heat_no: string | null;
  /** Derived from heat_entries: every serial (erp_code-valve type short form-heat_no-heat_seq), comma-joined. */
  serial_no: string | null;
  /**
   * Ordered but not yet received against a GRN, summed over this item's open
   * purchase order lines (`@gmd/purchase`). Not stored on PhysicalStock: the
   * host app's `load()` fills it by ERP code, and leaves it null when it does
   * not read purchase data — blank means "unknown", never "none on the way".
   */
  in_transit: number | null;
  /** Open PO lines behind `in_transit` (supplier, PO no/date, due, pending/received); filled like it. */
  incoming_from: string | null;
  /** Same location + L columns as another row with a different ERP code (only sent when the flag is on). */
  is_duplicate?: boolean;
}

/** Flange dims typed per serial on the heat-entry page; labels in DIMENSION_FIELDS (dimensions.ts). */
export const HEAT_DIM_KEYS = ["od", "id_mm", "pcd", "bolt_holes", "flange_thickness"] as const;
export type HeatDims = Record<(typeof HEAT_DIM_KEYS)[number], string | null>;

export interface HeatEntryRow extends HeatDims {
  id: string;
  heat_no: string;
  heat_seq: number;
  serial_no: string;
  sheet_file_id: string | null;
}

/** One assigned serial, with the valve type and size of its stock row. */
export interface HeatSerial {
  id: string;
  serial_no: string;
  valve_type: string | null;
  size: string | null;
}

/** One ERP code in the mobile heat-entry queue. */
export interface HeatQueueItem {
  id: string;
  erp_code: string | null;
  location: string | null;
  available_qty: string | null;
  description: string;
  entries: HeatEntryRow[];
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** One page of the table plus the sidebar figures; apps with updateBomId add per-row BOM ID options. */
export type PhysicalStockPageData = TablePage<PhysicalStockRow, StockPageMeta & { bomIdOptions?: Record<string, string[]> }>;

export const NEW_ITEM_FIELDS = [
  "location",
  "l2_valve_type",
  "dimension",
  "l7_dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
] as const;

/** `erp_code` is a picked RM / BOM code; absent means generate one. */
export type NewItemInput = Partial<Record<(typeof NEW_ITEM_FIELDS)[number], string>> & { erp_code?: string };

/** One New Item submit booked against a stock row, as the Entry History page lists it. */
export interface StockEntryRow {
  id: string;
  entry_no: string;
  /** ISO string. */
  created_at: string;
  qty_type: "received" | "dispatch";
  qty: string | null;
  /** Counted in the row; false = reverted. */
  merged: boolean;
  created_by: string | null;
  erp_code: string | null;
  location: string | null;
  /** Valve type / dia / component / material / std / PN of the row. */
  description: string;
}

/** Server Actions behind the Entry History page. */
export interface EntryHistoryActions {
  loadEntries: (erpCode: string) => Promise<ActionResult<StockEntryRow[]>>;
  /** Admin / developer only. */
  revertEntry?: (entryNo: string) => Promise<ActionResult<null>>;
  /** Admin / developer only: counts a reverted entry again. */
  restoreEntry?: (entryNo: string) => Promise<ActionResult<null>>;
}

/** Set when editing a blank-ERP row folded it into an existing item (the edited row is deleted). */
export interface MergeInfo {
  erp_code: string;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
}

export type FieldUpdate = Partial<PhysicalStockRow> & { merged?: MergeInfo };

/** Server Actions the host app passes in. Optional ones switch features on. */
export interface PhysicalStockActions {
  loadPage: (query: TableQuery) => Promise<ActionResult<PhysicalStockPageData>>;
  /** Distinct values of one field under the other filters (facets, cascading edit dropdowns). */
  loadFacet: (field: string, query: TableQuery) => Promise<ActionResult<string[]>>;
  /** ERP-code options for the New Item picker, fetched when the dialog opens. */
  loadCodeOptions?: () => Promise<ActionResult<CodeOptions>>;
  updateField: (
    id: string,
    field: string,
    value: string | null,
  ) => Promise<ActionResult<FieldUpdate>>;
  create?: (input: NewItemInput) => Promise<ActionResult<{ erp_code: string; existing: boolean; entry_no: string }>>;
  /** Takes one entry's quantity back out of its row and marks the entry reverted. */
  revertEntry?: (entryNo: string) => Promise<ActionResult<null>>;
  updateBomId?: (
    id: string,
    bomId: string | null,
  ) => Promise<ActionResult<Partial<PhysicalStockRow>>>;
}
