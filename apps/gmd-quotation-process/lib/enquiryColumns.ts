/** Quotations table columns by position (the index is the key into `columnWidths` and the <col> order). */
export const ENQUIRY_COLUMNS = [
  { key: "docket", label: "Docket", locked: true },
  { key: "location", label: "Location" },
  { key: "terms", label: "Terms & Contract" },
  { key: "contact", label: "Contact" },
  { key: "status", label: "Status" },
  { key: "projectReference", label: "Project Reference" },
  { key: "techEval", label: "Technical Evaluation" },
  { key: "reverseAuction", label: "Reverse Auction" },
  { key: "itemName", label: "Item Name" },
  { key: "details", label: "Details" },
  { key: "quantity", label: "Quantity" },
  { key: "itemCode", label: "Item Code" },
  { key: "bomId", label: "BOM ID" },
  { key: "productCost", label: "Product Cost" },
  { key: "costRefCode", label: "Cost Ref Code" },
  { key: "cost", label: "Cost" },
  { key: "stockStatus", label: "Stock Status" },
  { key: "stockQuantity", label: "Stock Quantity" },
  { key: "availableStock", label: "Available Stock" },
  { key: "viewImage", label: "View Image" },
  { key: "stockAgainstContract", label: "Stock Against Contract" },
  { key: "discount", label: "Discount" },
  { key: "vaPercent", label: "VA%" },
  { key: "quotedRate", label: "Quoted Rate" },
  { key: "crRate", label: "Rate (Contract Review)" },
  { key: "pdCostVal", label: "PD Cost Val" },
  { key: "qrInclGst", label: "QR incl. GST" },
  { key: "itemNameMerge", label: "Item Name (Merge)" },
  { key: "totalValue", label: "Total Value" },
  { key: "itemwiseTotal", label: "Itemwise Total Value" },
  { key: "validation", label: "Validation" },
  { key: "deliverySchedule", label: "Delivery Schedule" },
  { key: "apm", label: "APM" },
  { key: "offerPdf", label: "Offer PDF" },
  { key: "sendEmail", label: "Send Email" },
  { key: "actions", label: "Actions", locked: true },
] as const satisfies readonly { key: string; label: string; locked?: true }[];

export type EnquiryColumnKey = (typeof ENQUIRY_COLUMNS)[number]["key"];

export const ALL_COLUMN_KEYS: EnquiryColumnKey[] = ENQUIRY_COLUMNS.map((c) => c.key);
const LOCKED: EnquiryColumnKey[] = ["docket", "actions"];

// Exact sets from the product owner's mail ("Items" = item name, details, quantity; Closure is part of the Status cell).
// Follow-up and Commercial must fit a 1366 px screen without a horizontal scrollbar (see tests/enquiryColumns.test.ts).
export const COLUMN_VIEWS = {
  pricing: {
    label: "Pricing",
    columns: [...LOCKED, "itemName", "details", "quantity", "cost", "vaPercent", "validation"] as EnquiryColumnKey[],
  },
  followUp: { label: "Follow-up", columns: [...LOCKED, "contact", "status"] as EnquiryColumnKey[] },
  commercial: { label: "Commercial", columns: [...LOCKED, "terms", "location"] as EnquiryColumnKey[] },
} as const;
export type ColumnViewId = keyof typeof COLUMN_VIEWS;

/** Which saved view a column set equals, or null for a hand-picked set. */
export function matchingView(visible: readonly string[]): ColumnViewId | null {
  const set = new Set(visible);
  for (const id of Object.keys(COLUMN_VIEWS) as ColumnViewId[]) {
    const cols = COLUMN_VIEWS[id].columns;
    if (cols.length === set.size && cols.every((c) => set.has(c))) return id;
  }
  return null;
}

/** Columns the table shows: every column when analytics is off, else the saved view. */
export function effectiveColumns(analyticsOn: boolean, stored: string[]): string[] {
  return analyticsOn ? stored : ALL_COLUMN_KEYS;
}
