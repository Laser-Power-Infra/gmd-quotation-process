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
  actuator: string | null; rate: number; balanceQty: number;        // balanceQty = BAL BILL AG CONT
  inspection: "DONE" | "PENDING"; offer: "DONE" | "PENDING";
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
}
