import * as XLSX from "xlsx";
import type { RowError } from "@/lib/supplierRateUpload";

/** Bulk 1 PCS WGT upload (ERP code + weight in kg). Pure parse; the action does the write. */
export const PCS_WGT_HEADERS = ["ERP Item Code", "1 PCS WGT"] as const;

export interface PcsWgtRow {
  erpItemCode: string;
  pcsWgt: number;
}

const squash = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const headerKey = (v: unknown) => squash(v).toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parsePcsWgtRows(rows: unknown[][]): { weights: PcsWgtRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const header = (rows[0] ?? []).map(headerKey);
  const codeIdx = header.indexOf(headerKey(PCS_WGT_HEADERS[0]));
  // Accept the page's own "1 pcs wgt" header too, so an export can be re-uploaded.
  const wgtIdx = header.findIndex((h) => h === headerKey(PCS_WGT_HEADERS[1]) || h === "1PCSWGT" || h === "WEIGHT");
  if (codeIdx === -1) errors.push({ row: 1, message: `Missing column "${PCS_WGT_HEADERS[0]}"` });
  if (wgtIdx === -1) errors.push({ row: 1, message: `Missing column "${PCS_WGT_HEADERS[1]}"` });
  if (errors.length) return { weights: [], errors };

  const weights: PcsWgtRow[] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (!cells || cells.every((c) => squash(c) === "")) return;
    const erpItemCode = squash(cells[codeIdx]).toUpperCase();
    if (!erpItemCode) {
      errors.push({ row, message: "ERP Item Code is required" });
      return;
    }
    const raw = cells[wgtIdx];
    if (squash(raw) === "") return; // still unfilled by the supplier; skip quietly
    const pcsWgt = typeof raw === "number" ? raw : Number(squash(raw).replace(/,/g, ""));
    if (!Number.isFinite(pcsWgt) || pcsWgt <= 0) {
      errors.push({ row, message: `${erpItemCode}: 1 PCS WGT must be a number above 0 (got "${squash(raw)}")` });
      return;
    }
    if (seen.has(erpItemCode)) {
      errors.push({ row, message: `${erpItemCode}: repeated, same code as row ${seen.get(erpItemCode)}` });
      return;
    }
    seen.set(erpItemCode, row);
    weights.push({ erpItemCode, pcsWgt });
  });
  return { weights, errors };
}

export function parsePcsWgtFile(data: ArrayBuffer | Uint8Array): { weights: PcsWgtRow[]; errors: RowError[] } {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { weights: [], errors: [{ row: 1, message: "The file has no sheet" }] };
  return parsePcsWgtRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false }));
}
