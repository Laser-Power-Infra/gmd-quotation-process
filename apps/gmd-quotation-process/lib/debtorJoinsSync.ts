/**
 * SALE BILL / SALE REGISTER / BG tabs (execution-tracking workbook) -> `SaleBill`,
 * `SaleRegister`, `BankGuarantee`. Same rules as `debtorsSync.ts`: tabs resolved by
 * gid, exact (normalised) header match so a renamed column fails loudly.
 */
import { cell, requireColumns } from "./gmd_lib/bomMastErp";
import { parseAmount } from "./debtorsSync";

export const SALE_BILL_GID = 604337671;
export const SALE_REGISTER_GID = 475807928;
export const BG_GID = 1254252018;

export const SALE_BILL_HEADERS = ["VRNO", "ORDER_VRNO", "PARTYREFNO", "CONSIGNEE_CODE", "CONSIGNEE_ADD", "ITEM_CODE"] as const;
export const SALE_REGISTER_HEADERS = ["INVOICE NO", "ITEM NAME", "ORDER COPY", "INVOICE", "INSPECTION REPORT", "DRIVE LINK"] as const;
export const BG_HEADERS = ["BG_NO", "BG_AMT", "CANCELLED_STATUS", "BENEFICIARY_NAME"] as const;

const text = (row: string[], i: number) => cell(row, i) || null;

export function mapSaleBill(row: string[], c: number[]) {
  const vrNo = cell(row, c[0]);
  if (!vrNo) return null;
  return { vrNo, orderVrNo: text(row, c[1]), partyRefNo: text(row, c[2]), consigneeCode: text(row, c[3]), consigneeAdd: text(row, c[4]), itemCode: text(row, c[5]) };
}

export function mapSaleRegister(row: string[], c: number[]) {
  const invoiceNo = cell(row, c[0]);
  if (!invoiceNo) return null;
  return { invoiceNo, itemName: text(row, c[1]), orderCopy: text(row, c[2]), invoice: text(row, c[3]), inspectionReport: text(row, c[4]), driveLink: text(row, c[5]) };
}

/** Throws on a non-numeric BG_AMT (caller lists it as skipped). */
export function mapBg(row: string[], c: number[]) {
  const beneficiaryName = cell(row, c[3]);
  if (!beneficiaryName) return null;
  return { bgNo: text(row, c[0]), bgAmt: parseAmount(cell(row, c[1])), cancelledStatus: text(row, c[2]), beneficiaryName };
}

export const resolveCols = (headers: string[], required: readonly string[], tab: string) =>
  requireColumns(headers, [...required], tab);
