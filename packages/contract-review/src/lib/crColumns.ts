import { isDateHeader } from "@gmd/dashboard/lib/sheet-columns";
import { CONTRACT_REVIEW_HEADERS } from "./columns";

// Per-column rules for Contract Review: which DB field a header reads and how
// its values behave (sort / filter). The SQL query module is driven by this.

export type CrColumnKind = "text" | "number" | "date" | "list";

export interface CrColumn {
  header: string;
  /** ContractReview column; null when the cell is computed from other columns. */
  field: string | null;
  kind: CrColumnKind;
}

/** DB field per header, in CONTRACT_REVIEW_HEADERS order (same order as dbContractReviewToRow). */
const FIELDS: (string | null)[] = [
  "contractNo", "dateOfContract", "partyNameDump", "itemCode", "itemName", "partyItemName",
  "mcNo", "mcDate", "approvalDate", "poNo", "rate", "docketNo", "quotedRate",
  null, // RATE DIFF %
  "value", "vaPercentfromcost", "costfromQuotation", "cv", "vaPercent", "orderQty",
  "freeStock", "finalReq", "mcQty", "balanceMc", "prodOrdQty", "balanceToProdOrd",
  "balanceToProdEnt", "diQty", "billedQty", "balBillAgCont", "balDiQty", "balMcVal",
  "balProdOrdVal", "balToProdOrdEntVal", "balBillAgContVal", "balBillAgMcVal", "balDiVal",
  "diVal", "item", "size", "pnRating", "costCodeRef", "bomId", "rmPhysicalStock",
  "clearanceStatus", "actuator", "rmCodeForActuator", "rmCodeForGb", "paymentTerms",
  "lcRtgsRefNo", "lcDateRtgsDate", "lastDateOfShipmentDateOfLc", "issuingBankName",
  "bomFormulaTrial", "itemType", "erpPartyNameFromGmdSupplyHistory", "jobCode",
  "balBillAgMc", "icQty", "noUse", "status", "mcReceivedPending", "inspection",
  "offerPendingDone", "remarks", "state", "utility", "projectReference", "offerNumber",
  "inspectionNumber", "diDate", "orderList", "productionOrderNumber",
  null, // PROD ENTRY QTY
  "prodEntryDate", "diagramUrl", "mailDocs", "cBatch", "nBatch",
  null, // DATA INCOMPLETE
];

/** The String[] columns, shown joined with ", ". */
const LIST_FIELDS = new Set(["offerNumber", "inspectionNumber", "diDate", "orderList"]);

const NUMBER_HEADERS = new Set([
  "RATE", "QUOTED RATE", "RATE DIFF %", "VALUE", "VA % FROM COST", "COST FROM QUOTATION",
  "CV", "VA %", "ORDER QTY", "FREE STOCK", "FINAL REQ", "MC QTY", "Balance mc",
  "PROD ORD QTY", "BALANCE TO PROD ORD", "BALANCE TO PROD ENT", "DI QTY", "BILLED QTY",
  "BAL BILL AG CONT", "BAL DI QTY", "BAL MC VAL", "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL", "BAL BILL AG CONT VAL", "BAL BILL AG MC VAL", "BAL DI VAL",
  "DI VAL", "PHYSICAL STOCK", "BAL BILL AG MC", "ic qty", "PROD ENTRY QTY",
]);

export const CR_COLUMNS: CrColumn[] = CONTRACT_REVIEW_HEADERS.map((header, i) => {
  const field = FIELDS[i] ?? null;
  const kind: CrColumnKind =
    field && LIST_FIELDS.has(field)
      ? "list"
      : isDateHeader(header)
        ? "date"
        : NUMBER_HEADERS.has(header)
          ? "number"
          : "text";
  return { header, field, kind };
});

const BY_HEADER = new Map(CR_COLUMNS.map((c) => [c.header, c]));

export const crColumn = (header: string): CrColumn | undefined => BY_HEADER.get(header);
