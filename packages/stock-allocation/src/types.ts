export type Stage = "Booked" | "Offered" | "Inspection done" | "Dispatched";
export type Basis = "Finished" | "Assemble" | "Actuator to map";

export interface StockItem {            // one PhysicalStock row
  id: string; erpCode: string; location: string | null;
  valveType: string | null; dimension: string | null; component: string | null;
  material: string | null; std: string | null; pn: string | null;   // l2, Dia, l4, l5, l6, l7
  category: string | null; itemType: string | null;                 // l8, item_type
  availableQty: number;
}
export interface ContractLine {         // one live ContractReview row
  id: string; contractNo: string; party: string; poNo: string | null; project: string | null;
  dateOfContract: string | null;        // as stored, e.g. "2-May-2024"; parse with lib/gmd_lib/dateParse
  itemCode: string; itemName: string; item: string | null; size: string | null; pnRating: string | null;
  partyItemName?: string | null;        // the customer's own wording of the item; used in lists sent outside
  actuator: string | null; rate: number; balanceQty: number;       // balanceQty = BAL BILL AG CONT
  inspection: "DONE" | "PENDING"; offer: "DONE" | "PENDING";
  // Left out = MC received, MC qty unknown, nothing billed.
  mcPending?: boolean;                  // MC Received/Pending = Pending: holds stock only after every MC-received line
  mcNo?: string | null; mcDate?: string | null; mcQty?: number | null; billedQty?: number;
  state?: string | null;                // Contract Review STATE
  rmCodeForGb?: string | null;          // comma-joined, like rmCodeForActuator
  bomId?: string | null;
}
export interface LedgerEntry {          // persisted StockAllocation row
  id: string; erpCode: string; location: string | null; contractNo: string; itemCode: string;
  qty: number; source: "manual" | "locked"; basis: Basis | null; remarks: string | null; allocatedAt: string;
}
export interface Allocation {           // one stock row → one contract line
  stockId: string; erpCode: string; location: string | null;
  contractNo: string; itemCode: string; party: string; poNo: string | null;
  qty: number; stage: Stage; basis: Basis; source: "manual" | "locked" | "auto";
  ledgerId: string | null; spare: boolean; flags: string[]; allocatedAt: string | null;
}
export interface OfferLine {
  line: ContractLine; offerableQty: number; offerValue: number;      // rate × qty, excl. GST
  rmCodes: { erpCode: string; location: string | null; qty: number; spare: boolean }[];
  basis: Basis; flags: string[]; offerSent: boolean; remarks: string | null;
}
export interface LedgerView { erpCode: string; location: string | null; description: string; availableQty: number;
  allocatedTo: { contractNo: string; itemCode: string; qty: number; stage: Stage }[]; allocatedQty: number; freeBalance: number; }
export interface ShortContract { contractNo: string; party: string; shortValue: number;
  lines: { line: ContractLine; shortQty: number; shortValue: number }[]; }
export interface AllocationResult {
  allocations: Allocation[]; offerNow: OfferLine[]; ledger: LedgerView[]; notInStock: ShortContract[];
  summary: { finished: number; assemble: number; actuator: number; short: number;   // values (Rs)
             finishedLines: number; assembleLines: number; actuatorLines: number };
  /** One per live order line (MC received and MC pending). */
  lines: LineAllocation[];
  /** Purchase lines with allocations (set by computeStockAllocation; internal). */
  purchaseLines?: PurchaseLineView[];
}

/** Where a contract line's stock comes from on the purchase side. Internal: never goes into Ready to Bill or any outside list. */
export interface PurchaseSource {
  poNo: string; poLineNo: string; lot: string | null; tinaInvoiceNo: string | null; blNo: string | null; eta: string | null;
  qty: number; state: "incoming" | "received" | "short"; needsConfirmation: boolean;
}
/** One purchase line with who holds it; freeBalance = ordered - all allocations. */
export interface PurchaseLineView {
  poNo: string; poLineNo: string; itemCode: string; ordered: number; received: number; pending: number;
  allocatedTo: { contractNo: string; itemCode: string; qty: number; state: "incoming" | "received" | "short" }[]; freeBalance: number;
}
/** One purchase allocation, split by the host into received / incoming / short qty. */
export interface PurchaseAllocationInput {
  contractNo: string; itemCode: string; erpCode: string; physicalQty: number; incomingQty: number; shortQty: number;
  poNo: string; poLineNo: string; lot: string | null; tinaInvoiceNo: string | null; blNo: string | null; eta: string | null;
  shipStatus: string | null; needsConfirmation: boolean;
  /** Tie-break when several lines claim the same received stock: oldest allocatedAt, then id. */
  id?: string; allocatedAt?: string;
}

/** What the host app reads for the live lines; the package never touches the quotation DB or Google. All optional. */
export interface AllocationInputs {
  /** Qty already offered for inspection per Contract Review line id, billed qty included. A line left out, or at 0
   *  while its Offer / Inspection is DONE (the MC register can lag), counts as wholly offered once DONE, as before. */
  offered?: Record<string, number>;
  /** Major BOM parts per Contract Review line id: ERP code and qty per valve. A line left out has no RM route. */
  boms?: Record<string, { erpCode: string; qty: number }[]>;
  /** China shipments (GMD CLIENTS WISE > CHINA SHIPMENTS). */
  incoming?: { erpCode: string; qty: number; eta: string | null }[];
  /** Purchase allocations: received qty is reserved on stock first, incoming qty counts as incoming, short qty is flagged. */
  purchaseAllocations?: PurchaseAllocationInput[];
}
/** Reads AllocationInputs for the lines computeStockAllocation loaded, so only their contracts and BOMs are read. */
export type InputsLoader = (lines: ContractLine[]) => Promise<AllocationInputs>;

export type LineStatus =
  | "Ready for inspection call" | "Allocated - wiring change required"
  | "MC pending - stock held"    // an MC-pending line whose whole balance is held: no inspection call without the MC
  | "Partial" | "Not available"
  | "Fully offered"              // nothing left to offer
  | "Blue Star - left out for now";

/** One order line under the 18 Nov rules. Every qty is against the balance to offer. */
export interface LineAllocation {
  id: string;                    // Contract Review line id
  balanceToOffer: number;        // MC qty − qty already offered; MC pending: the balance qty
  fgQty: number;                 // held from finished (physical) stock
  rmRouteQty: number;            // can be assembled from RM stock (major BOM parts), taken after finished stock
  incomingQty: number;           // from China shipments; never physical
  eta: string | null;            // of the last shipment used
  shortfall: number;             // balanceToOffer − fgQty − rmRouteQty − incomingQty
  status: LineStatus;
  actuatorFree: number | null;   // free qty of the approved actuator; null = no actuator on the line
  gbFree: number | null;         // free qty of the rmCodeForGb code(s); null = none
  flags: string[];
  sources: PurchaseSource[];     // purchase allocations behind this line; internal only
  suggestions: { erpCode: string; qty: number; note: "possible after machining" }[];
}

export type ActionResult<T = null> = { success: true; data: T } | { success: false; error: string };
/** Server Actions the host app supplies; the app owns auth and revalidation. */
export interface StockAllocationActions {
  addBookingAction(input: { erpCode: string; location: string | null; contractNo: string; itemCode: string; qty: number; remarks: string | null }): Promise<ActionResult<unknown>>;
  updateBookingAction(id: string, input: { qty: number; remarks?: string | null }): Promise<ActionResult<unknown>>;
  deleteBookingAction(id: string): Promise<ActionResult<unknown>>;
  setOfferSentAction(input: {
    contractNo: string; itemCode: string; sent: boolean; basis: Basis; remarks: string | null;
    rmCodes: { erpCode: string; location: string | null; qty: number }[];
  }): Promise<ActionResult<unknown>>;
  reloadAction(): Promise<ActionResult<AllocationResult>>;
  /** Allocate part of a purchase line to a contract line. The host sets who and `source: "manual"`; capacity and duplicate errors come back as text. */
  addPurchaseAllocationAction(input: NewPurchaseAllocation): Promise<ActionResult<unknown>>;
  updatePurchaseAllocationAction(id: string, input: { qty: number; remarks?: string | null }): Promise<ActionResult<unknown>>;
  deletePurchaseAllocationAction(id: string): Promise<ActionResult<unknown>>;
}
/** What the Stock Allocation page sends to add a purchase allocation (blank text = none). */
export interface NewPurchaseAllocation {
  poNo: string; poLineNo: string; contractNo: string; itemCode: string; qty: number;
  lot: string | null; tinaInvoiceNo: string | null; blNo: string | null; eta: string | null; needsConfirmation: boolean; remarks: string | null;
}
