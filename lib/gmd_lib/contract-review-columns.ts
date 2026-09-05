export const CONTRACT_REVIEW_HEADERS = [
  "CONTRACT NO",
  "ITEM_CODE",
  "MC NO",
  "ITEM_NAME",
  "PARTY ITEM NAME",
  "RATE",
  "CV",
  "VA %",
  "ORDER QTY",
  "FREE STOCK",
  "FINAL REQ",
  "MC QTY",
  "Balance mc",
  "PROD ORD QTY",
  "BALANCE TO PROD ORD",
  "BALANCE TO PROD ENT",
  "DI QTY",
  "BILLED QTY",
  "BAL BILL AG CONT",
  "BAL DI QTY",
  "BAL MC VAL",
  "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL",
  "BAL BILL AG CONT VAL",
  "BAL BILL AG MC VAL",
  "BAL DI VAL",
  "DI VAL",
  "Item",
  "VALUE",
  "SIZE",
  "PN RATING",
  "DATE OF CONTRACT",
  "CLEARANCE STATUS",
  "Actuator",
  "ITEM TYPE",
  "RM CODE FOR ACTUATOR",
  "RM CODE FOR GB",
  "PAYMENT TERMS",
  "LC/RTGS REF NO",
  "LC DATE/RTGS DATE",
  "LAST DATE OF SHIPMENT/DATE OF LC",
  "Issuing bank name",
  "bom formula trial",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
  "JOB Code",
  "BAL BILL AG MC",
  "ic qty",
  "BOM ID",
] as const;

export const CONTRACTS_SHEET_COLUMNS = [
  "CONTRACT NO",
  "ITEM_CODE",
  "MC NO",
  "ITEM_NAME",
  "PARTY ITEM NAME",
  "RATE",
  "CV",
  "VA %",
  "ORDER QTY",
  "FREE STOCK",
  "FINAL REQ",
  "MC QTY",
  "Balance mc",
  "PROD ORD QTY",
  "BALANCE TO PROD ORD",
  "BALANCE TO PROD ENT",
  "DI QTY",
  "BILLED QTY",
  "BAL BILL AG MC",
  "BAL BILL AG CONT",
  "Item",
  "VALUE",
  "SIZE",
  "PN RATING",
  "DATE OF CONTRACT",
  "CLEARANCE STATUS",
  "Actuator",
  "RM CODE FOR ACTUATOR",
  "RM CODE FOR GB",
  "PAYMENT TERMS",
  "LC/RTGS REF NO",
  "LC DATE/RTGS DATE",
  "LAST DATE OF SHIPMENT/DATE OF LC",
  "Issuing bank name",
  "bom formula trial",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
  "ITEM TYPE",
] as const;

export const DUMP_SHEET_COLUMNS = [
  "JOB Code",
  "BAL DI QTY",
  "BAL MC VAL",
  "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL",
  "BAL BILL AG MC VAL",
  "BAL BILL AG CONT VAL",
  "BAL DI VAL",
  "DI VAL",
  "ic qty",
  "BAL BILL AG MC",
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ").replace(/\n/g, "");
}

export function buildContractsColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  return CONTRACTS_SHEET_COLUMNS.map((col) => {
    const target = normalizeHeader(col);
    return normalized.findIndex((h) => h === target);
  });
}

export function buildDumpColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  return DUMP_SHEET_COLUMNS.map((col) => {
    const target = normalizeHeader(col);
    return normalized.findIndex((h) => h === target);
  });
}

export function mapContractReviewRow(
  contractRow: unknown[],
  dumpRow: unknown[] | null,
  contractsColumnMap: number[],
  dumpColumnMap: number[],
) {
  const getVal = (row: unknown[], sheetIdx: number): string | null => {
    if (sheetIdx < 0) return null;
    const v = row[sheetIdx];
    return v != null && v !== "" ? String(v).trim() : null;
  };

  const field = (
    canonicalIdx: number,
  ): string | null => getVal(contractRow, contractsColumnMap[canonicalIdx]);

  return {
    contractNo: field(0) ?? "",
    itemCode: field(2) ?? "",
    mcNo: field(1),
    itemName: field(3),
    partyItemName: field(4),
    rate: field(5),
    cv: field(6),
    vaPercent: field(7),
    orderQty: field(8),
    freeStock: field(9),
    finalReq: field(10),
    mcQty: field(11),
    balanceMc: field(12),
    prodOrdQty: field(13),
    balanceToProdOrd: field(14),
    balanceToProdEnt: field(15),
    diQty: field(16),
    billedQty: field(17),
    balBillAgCont: field(19),
    item: field(20),
    value: field(21),
    size: field(22),
    pnRating: field(23),
    dateOfContract: field(24),
    clearanceStatus: field(25),
    actuator: field(26),
    rmCodeForActuator: field(27),
    rmCodeForGb: field(28),
    paymentTerms: field(29),
    lcRtgsRefNo: field(30),
    lcDateRtgsDate: field(31),
    lastDateOfShipmentDateOfLc: field(32),
    issuingBankName: field(33),
    bomFormulaTrial: field(34),
    erpPartyNameFromGmdSupplyHistory: field(35),
    itemType: field(36),
    jobCode: dumpRow ? getVal(dumpRow, dumpColumnMap[0]) : null,
    balBillAgMc: dumpRow ? getVal(dumpRow, dumpColumnMap[10]) : null,
    balDiQty: dumpRow ? getVal(dumpRow, dumpColumnMap[1]) : null,
    balMcVal: dumpRow ? getVal(dumpRow, dumpColumnMap[2]) : null,
    balProdOrdVal: dumpRow ? getVal(dumpRow, dumpColumnMap[3]) : null,
    balToProdOrdEntVal: dumpRow ? getVal(dumpRow, dumpColumnMap[4]) : null,
    balBillAgMcVal: dumpRow ? getVal(dumpRow, dumpColumnMap[5]) : null,
    balBillAgContVal: dumpRow ? getVal(dumpRow, dumpColumnMap[6]) : null,
    balDiVal: dumpRow ? getVal(dumpRow, dumpColumnMap[7]) : null,
    diVal: dumpRow ? getVal(dumpRow, dumpColumnMap[8]) : null,
    icQty: dumpRow ? getVal(dumpRow, dumpColumnMap[9]) : null,
  };
}

export function dbContractReviewToRow(item: {
  contractNo: string | null;
  itemCode: string | null;
  mcNo: string | null;
  itemName: string | null;
  partyItemName: string | null;
  rate: string | null;
  cv: string | null;
  vaPercent: string | null;
  orderQty: string | null;
  freeStock: string | null;
  finalReq: string | null;
  mcQty: string | null;
  balanceMc: string | null;
  prodOrdQty: string | null;
  balanceToProdOrd: string | null;
  balanceToProdEnt: string | null;
  diQty: string | null;
  billedQty: string | null;
  balBillAgCont: string | null;
  balDiQty: string | null;
  balMcVal: string | null;
  balProdOrdVal: string | null;
  balToProdOrdEntVal: string | null;
  balBillAgContVal: string | null;
  balBillAgMcVal: string | null;
  balDiVal: string | null;
  diVal: string | null;
  item: string | null;
  value: string | null;
  size: string | null;
  pnRating: string | null;
  dateOfContract: string | null;
  clearanceStatus: string | null;
  actuator: string | null;
  itemType: string | null;
  rmCodeForActuator: string | null;
  rmCodeForGb: string | null;
  paymentTerms: string | null;
  lcRtgsRefNo: string | null;
  lcDateRtgsDate: string | null;
  lastDateOfShipmentDateOfLc: string | null;
  issuingBankName: string | null;
  bomFormulaTrial: string | null;
  erpPartyNameFromGmdSupplyHistory: string | null;
  jobCode: string | null;
  balBillAgMc: string | null;
  icQty: string | null;
  bomId: string | null;
}): unknown[] {
  return [
    item.contractNo, item.itemCode, item.mcNo,
    item.itemName, item.partyItemName, item.rate,
    item.cv, item.vaPercent,
    item.orderQty,
    item.freeStock, item.finalReq, item.mcQty,
    item.balanceMc,
    item.prodOrdQty, item.balanceToProdOrd, item.balanceToProdEnt,
    item.diQty, item.billedQty,
    item.balBillAgCont,
    item.balDiQty, item.balMcVal, item.balProdOrdVal,
    item.balToProdOrdEntVal, item.balBillAgContVal, item.balBillAgMcVal,
    item.balDiVal, item.diVal,
    item.item, item.value, item.size, item.pnRating,
    item.dateOfContract, item.clearanceStatus, item.actuator,
    item.itemType,
    item.rmCodeForActuator, item.rmCodeForGb, item.paymentTerms,
    item.lcRtgsRefNo, item.lcDateRtgsDate, item.lastDateOfShipmentDateOfLc,
    item.issuingBankName, item.bomFormulaTrial, item.erpPartyNameFromGmdSupplyHistory,
    item.jobCode, item.balBillAgMc, item.icQty,
    item.bomId,
  ];
}

export const CONTRACT_REVIEW_HEADER_TO_DB_FIELD: Record<string, string> = {
  "CONTRACT NO": "contractNo",
  "MC NO": "mcNo",
  "ITEM_CODE": "itemCode",
  "ITEM_NAME": "itemName",
  "PARTY ITEM NAME": "partyItemName",
  "RATE": "rate",
  "CV": "cv",
  "VA %": "vaPercent",
  "ORDER QTY": "orderQty",
  "FREE STOCK": "freeStock",
  "FINAL REQ": "finalReq",
  "MC QTY": "mcQty",
  "Balance mc": "balanceMc",
  "PROD ORD QTY": "prodOrdQty",
  "BALANCE TO PROD ORD": "balanceToProdOrd",
  "BALANCE TO PROD ENT": "balanceToProdEnt",
  "DI QTY": "diQty",
  "BILLED QTY": "billedQty",
  "BAL BILL AG MC": "balBillAgMc",
  "BAL BILL AG CONT": "balBillAgCont",
  "Item": "item",
  "VALUE": "value",
  "SIZE": "size",
  "PN RATING": "pnRating",
  "DATE OF CONTRACT": "dateOfContract",
  "CLEARANCE STATUS": "clearanceStatus",
  "Actuator": "actuator",
  "RM CODE FOR ACTUATOR": "rmCodeForActuator",
  "RM CODE FOR GB": "rmCodeForGb",
  "PAYMENT TERMS": "paymentTerms",
  "LC/RTGS REF NO": "lcRtgsRefNo",
  "LC DATE/RTGS DATE": "lcDateRtgsDate",
  "LAST DATE OF SHIPMENT/DATE OF LC": "lastDateOfShipmentDateOfLc",
  "Issuing bank name": "issuingBankName",
  "bom formula trial": "bomFormulaTrial",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY": "erpPartyNameFromGmdSupplyHistory",
  "ITEM TYPE": "itemType",
  "JOB Code": "jobCode",
  "BAL DI QTY": "balDiQty",
  "BAL MC VAL": "balMcVal",
  "BAL PROD ORD VAL": "balProdOrdVal",
  "BAL TO PROD ORD ENT VAL": "balToProdOrdEntVal",
  "BAL BILL AG MC VAL": "balBillAgMcVal",
  "BAL BILL AG CONT VAL": "balBillAgContVal",
  "BAL DI VAL": "balDiVal",
  "DI VAL": "diVal",
  "ic qty": "icQty",
};
