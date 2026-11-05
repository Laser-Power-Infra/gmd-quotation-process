import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { BLANK_ONLY_HEADERS, COLUMNS, DROPDOWN_OPTIONS, FIELDS, NUMERIC_COLUMNS, type PhysicalStockHeader } from "./columns";
import type { PhysicalStockFlags } from "./flags";
import type { PhysicalStockRow } from "./types";

// Every per-column business rule of the stock table lives here: label, kind,
// whether it filters/sorts, how it edits. Flags (per app) only switch rules on
// or off through columnsFor(); the server reads the same list for SQL kinds.

export interface StockColumn {
  header: PhysicalStockHeader;
  field: keyof PhysicalStockRow;
  label: string;
  kind: "text" | "number" | "date" | "boolean";
  filter: boolean;
  sortable: boolean;
  /** text = free edit, blankOnly = fill once (unlocked on a blank-ERP row), select = dropdown. */
  edit?: "text" | "blankOnly" | "select";
  sticky?: boolean;
}

const LABELS: Record<PhysicalStockHeader, string> = {
  DATE: "Date",
  "ERP CODE": "ERP code",
  location: "Location",
  "ENTRY NO": "Entry no",
  "L2-VALVE TYPE": "Valve type",
  Dia: "Dia",
  "L4-COMPONENT": "Component",
  "L5- MATERIAL": "Material",
  "L6-STD": "Standard",
  "L7-PN": "PN",
  "L8 -ITEM CATEGORY": "Item category",
  "RECEIVED QTY.": "Received",
  "DISPATCH QTY.": "Dispatched",
  "AVAILABLE QTY.": "Available",
  REMARKS: "Remarks",
  "sum of PHYSICAL stock": "Physical stock",
  "stock as per erp": "Stock per ERP",
  "item wise-value": "Item value",
  "MOVING WITHIN 3 MONTHS": "Moving in 3 months",
  "Order Ag Approval recvd": "Order approval received",
  "PURCHASE IN 26-27": "Purchased 26-27",
  "dispatched in 26-27": "Dispatched 26-27",
  "ORDER IN hand QTY": "Order in hand",
  "shortage qty": "Shortage",
  "": "Extra",
  "item type": "Item type",
  PRICE: "Price",
  MOQ: "MOQ",
  "IF LESS THAN MOQ- EXTRA CHARGES": "Below-MOQ charges",
  "DRAWING/ TECHNICAL DATA": "Drawing / technical data",
  COST: "Cost",
  "BOM ID": "BOM ID",
  "MAJOR/MINOR MARKING": "Major / minor",
  "HEAT NO": "Heat no",
  "SERIAL NO": "Serial no",
  "IN TRANSIT": "In transit",
  "INCOMING FROM": "Incoming from",
  "FG ITEM CODE": "FG item code",
  "PRODUCTION ITEM": "Production item",
};

const STICKY = new Set<PhysicalStockHeader>(["ERP CODE", "location"]);
const BLANK_ONLY = new Set<string>(BLANK_ONLY_HEADERS);

function editOf(header: PhysicalStockHeader): StockColumn["edit"] {
  if (header === "ERP CODE" || header === "location") return "blankOnly";
  if (BLANK_ONLY.has(header)) return "select";
  if (header === "BOM ID") return "select";
  return "text";
}

export const STOCK_COLUMNS: StockColumn[] = COLUMNS.map((header, i) => ({
  header,
  field: FIELDS[i],
  label: LABELS[header],
  kind:
    header === "DATE" ? "date" : header === "MAJOR/MINOR MARKING" ? "boolean" : NUMERIC_COLUMNS.has(header) ? "number" : "text",
  filter: true,
  sortable: true,
  edit: editOf(header),
  sticky: STICKY.has(header),
}));

/** L / Dia fields whose edit dropdown cascades on the row's other levels (served by the facet query). */
export const CASCADE_FIELDS: readonly (keyof PhysicalStockRow)[] = [
  "l2_valve_type",
  "dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l7_dimension",
  "l8_item_category",
];

const isBlank = (v: unknown) => !String(v ?? "").trim();

/**
 * Columns the table renders for this app: hidden ones dropped, editability
 * resolved from the flags (BOM ID only when the host can save it).
 */
export function columnsFor(flags: PhysicalStockFlags, opts: { bomId: boolean }): DataColumn<PhysicalStockRow>[] {
  const hidden = new Set<string>(flags.hiddenColumns);
  const editable = new Set<string>(flags.editableColumns);
  return STOCK_COLUMNS.filter((c) => !hidden.has(c.header)).map((c) => {
    const col: DataColumn<PhysicalStockRow> = {
      key: c.field,
      label: c.label,
      kind: c.kind,
      filter: c.filter,
      sortable: c.sortable,
      sticky: c.sticky,
      align: c.kind === "number" ? "right" : "left",
    };
    if (c.field === "majorminor_marking") col.render = (row) => (row.majorminor_marking === true ? "Major" : row.majorminor_marking === false ? "Minor" : "");
    const on = c.edit && editable.has(c.header) && (c.header !== "BOM ID" || opts.bomId);
    if (!on) return col;
    col.edit = c.edit === "select" ? "select" : "text";
    col.options = DROPDOWN_OPTIONS[c.header];
    if (BLANK_ONLY.has(c.header)) {
      // Fill-once columns; a row with a blank ERP code may change everything but its code.
      col.canEdit = (row) => isBlank(row[c.field]) || (c.header !== "ERP CODE" && isBlank(row.erp_code));
    }
    return col;
  });
}
