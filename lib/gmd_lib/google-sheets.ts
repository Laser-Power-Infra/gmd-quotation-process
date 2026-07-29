import { google } from "googleapis";
import { CANONICAL_COLUMNS } from "./sheet-columns";

export interface SheetResult {
  sheetName: string;
  totalRows: number;
  errors: string[];
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function buildColumnMap(sheetHeaders: string[]): number[] {
  const normalized = sheetHeaders.map(normalizeHeader);
  const canonical = CANONICAL_COLUMNS.map(normalizeHeader);
  const used = new Set<number>();
  return canonical.map((col) => {
    for (let i = 0; i < normalized.length; i++) {
      if (!used.has(i) && normalized[i] === col) {
        used.add(i);
        return i;
      }
    }
    return -1;
  });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  return id;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Google service account credentials not configured");
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export async function fetchSheetMetadata(): Promise<{
  spreadsheetId: string;
  sheets: SheetResult[];
}> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  const sheetTitles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];

  const expectedSheets = ["NON CHAIN BOM", "MRP/IS"];
  for (const name of expectedSheets) {
    if (!sheetTitles.includes(name)) {
      throw new Error(`Sheet "${name}" not found in the spreadsheet`);
    }
  }

  const results: SheetResult[] = [];

  for (const sheetName of expectedSheets) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:ZZZ`,
        valueRenderOption: "UNFORMATTED_VALUE",
      });

      const rows = response.data.values ?? [];
      const dataRows = rows.length > 1 ? rows.slice(1).filter((r) => r.some((c) => c !== null && c !== "")) : [];

      results.push({ sheetName, totalRows: dataRows.length, errors: [] });
    } catch (err) {
      results.push({
        sheetName,
        totalRows: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    }
  }

  return { spreadsheetId, sheets: results };
}

export async function fetchGMDUpdateSheet(): Promise<{
  headers: string[];
  rows: unknown[][];
}> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];

  if (!sheetTitles.includes("GMD UPDATION")) {
    throw new Error('Sheet "GMD UPDATION" not found in the spreadsheet');
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'GMD UPDATION'!A:ZZZ",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];

  if (allRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = allRows[0].map(String);
  const rawRows = allRows.slice(1).filter((r) => r.some((c) => c !== null && c !== ""));

  const columnMap = buildColumnMap(rawHeaders);
  const headers = CANONICAL_COLUMNS;
  const rows = rawRows.map((row) => columnMap.map((idx) => (idx >= 0 ? row[idx] : null)));

  return { headers, rows };
}

export async function fetchGMDCategorySheet(): Promise<Record<string, string[]>> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];

  if (!sheetTitles.includes("GMD Category")) return {};

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'GMD Category'!A:ZZZ",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) return {};

  const headers = allRows[0].map(String);
  const data = allRows.slice(1);

  const result: Record<string, string[]> = {};
  headers.forEach((header, idx) => {
    const values = data
      .map((row) => String(row[idx] ?? ""))
      .filter((v) => v.trim() !== "");
    if (values.length > 0) {
      result[header] = [...new Set(values)].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    }
  });

  return result;
}

export async function fetchStockPhysicalSheet(): Promise<Record<string, string>> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];

  if (!sheetTitles.includes("stock-phys")) return {"iii":"eue"};

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'stock-phys'!A:ZZZ",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) return {};

  const headers = allRows[1].map(String);
  console.log(headers)
  const dataRows = allRows.slice(2);

  const erpIdx = headers.findIndex(
    (h) => normalizeHeader(h) === "ERP CODE",
  );
  const stockIdx = headers.findIndex(
    (h) => normalizeHeader(h) === "SUM OF PHYSICAL STOCK",
  );
  if (erpIdx === -1 || stockIdx === -1) return {"erp":erpIdx.toString(), "stock":stockIdx.toString()};

  const result: Record<string, string> = {};
  for (const row of dataRows) {
    const erp = String(row[erpIdx] ?? "").trim();
    const stock = String(row[stockIdx] ?? "").trim();
    if (erp && stock) result[erp] = stock;
  }
  // console.log(".....................result", result )
  return result;
}
