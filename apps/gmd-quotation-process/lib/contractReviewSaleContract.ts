// Contract Review: fill poNo (PARTYREFNO) and dateOfContract (PARTYREFDATE) from the
// "SALE CONTRACT" tab of the BOM MAST ERP workbook. Gap-fill only: a value already in
// Contract Review (typed or synced earlier) is never overwritten, a blank sheet cell never clears.
import { format } from "date-fns";
import { CANONICAL_DATE, excelSerialToDate, parseGmdDate } from "@/lib/gmd_lib/dateParse";

const SPREADSHEET_ID =
  process.env.CR_SALE_CONTRACT_SPREADSHEET_ID ?? "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";
const SALE_CONTRACT_GID = 1660993759;
/** Tried in order, compared normalised (lower-case alphanumerics). The tab's real header is unverified. */
const CONTRACT_HEADERS = ["contractno", "erpcontractno", "contractvrno", "salecontractno", "vrno"];
const CHUNK = 200;

const norm = (h: unknown) => String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const contractKey = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const FORMULA_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|ERROR!)$/i;

/** Sheet date text -> dd-MMM-yyyy (what ContractReview.dateOfContract holds), or null. Numeric dates are day-first. */
export function toContractDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let d: Date | null = null;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (/^\d+(\.\d+)?$/.test(s)) d = excelSerialToDate(Number(s));
  else if (m) d = +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  else d = parseGmdDate(s);
  return d && !isNaN(d.getTime()) ? format(d, CANONICAL_DATE) : null;
}

export type SaleContractFill = { poNo?: string; dateOfContract?: string };

/** contractKey -> first usable PARTYREFNO / PARTYREFDATE of that contract. Throws when a needed header is missing. */
export function indexSaleContract(all: unknown[][]): Map<string, SaleContractFill> {
  const headers = (all[0] ?? []).map(norm);
  const c = CONTRACT_HEADERS.map((h) => headers.indexOf(h)).find((i) => i >= 0) ?? -1;
  const po = headers.indexOf("partyrefno");
  const dt = headers.indexOf("partyrefdate");
  if (c < 0 || po < 0 || dt < 0) {
    throw new Error(`SALE CONTRACT tab: contract-number / PARTYREFNO / PARTYREFDATE header not found in [${(all[0] ?? []).join(" | ")}]`);
  }
  const out = new Map<string, SaleContractFill>();
  for (const row of all.slice(1)) {
    const key = contractKey(row[c]);
    if (!key) continue;
    const fill = out.get(key) ?? {};
    const poVal = String(row[po] ?? "").trim();
    if (!fill.poNo && poVal && !FORMULA_ERROR.test(poVal)) fill.poNo = poVal;
    if (!fill.dateOfContract) fill.dateOfContract = toContractDate(row[dt]) ?? undefined;
    out.set(key, fill);
  }
  return out;
}

/** What to write for one row: only the fields currently blank in the DB and available in the sheet. */
export function pickSaleContractFill(
  current: { poNo?: string | null; dateOfContract?: string | null },
  sheet: SaleContractFill | undefined,
): SaleContractFill {
  const data: SaleContractFill = {};
  if (sheet?.poNo && isBlank(current.poNo)) data.poNo = sheet.poNo;
  if (sheet?.dateOfContract && isBlank(current.dateOfContract)) data.dateOfContract = sheet.dateOfContract;
  return data;
}

export async function runSaleContractFill(opts: { apply?: boolean } = {}): Promise<{ matched: number; updated: number }> {
  // Dynamic imports keep the pure helpers above unit-testable without Prisma / Google.
  const { prisma: tenderPrisma } = await import("@gmd/db-tender");
  const { sheets: googleSheets } = await import("@googleapis/sheets");
  const { getOAuthClient } = await import("@/lib/googleAuth");
  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find((s) => s.properties?.sheetId === SALE_CONTRACT_GID);
  if (!tab?.properties?.title) throw new Error(`SALE CONTRACT tab (gid ${SALE_CONTRACT_GID}) not found`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab.properties.title}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const bySheet = indexSaleContract(res.data.values ?? []);

  const rows = await tenderPrisma.contractReview.findMany({
    where: { OR: [{ poNo: null }, { poNo: "" }, { dateOfContract: null }, { dateOfContract: "" }] },
    select: { id: true, contractNo: true, poNo: true, dateOfContract: true },
  });
  const plan = rows
    .map((r) => ({ id: r.id, data: pickSaleContractFill(r, bySheet.get(contractKey(r.contractNo))) }))
    .filter((p) => p.data.poNo || p.data.dateOfContract);
  if (opts.apply === false) return { matched: plan.length, updated: 0 };

  let updated = 0;
  for (let i = 0; i < plan.length; i += CHUNK) {
    // updateMany + blank guard: a value typed in the UI mid-run is not overwritten.
    const settled = await Promise.allSettled(
      plan.slice(i, i + CHUNK).flatMap(({ id, data }) => [
        data.poNo
          ? tenderPrisma.contractReview.updateMany({ where: { id, OR: [{ poNo: null }, { poNo: "" }] }, data: { poNo: data.poNo } })
          : null,
        data.dateOfContract
          ? tenderPrisma.contractReview.updateMany({
              where: { id, OR: [{ dateOfContract: null }, { dateOfContract: "" }] },
              data: { dateOfContract: data.dateOfContract },
            })
          : null,
      ]).filter((p) => p !== null),
    );
    updated += settled.filter((s) => s.status === "fulfilled").length;
  }
  return { matched: plan.length, updated };
}
