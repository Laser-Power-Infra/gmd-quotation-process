import { google } from "googleapis";

const CONTRACT_SHEET_SPREADSHEET_ID = process.env.CONTRACT_SHEET_SPREADSHEET_ID;
const CONTRACT_SHEET_GID = 1367392830;

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

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ").replace(/\n/g, "");
}

export function normalizePo(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function stripDtSuffix(value: string): string {
  return normalizePo(value).replace(/\s+DT(\s|\..*)?$/, "").trim();
}

export function matchOrderLink(
  partyOrderNo: string | null | undefined,
  map: Map<string, string>,
): string | null {
  if (!partyOrderNo) return null;
  const key = normalizePo(partyOrderNo);
  const exact = map.get(key);
  if (exact) return exact;
  const stripped = stripDtSuffix(key);
  if (stripped !== key) return map.get(stripped) ?? null;
  return null;
}

export async function buildContractOrderLinkMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!CONTRACT_SHEET_SPREADSHEET_ID) return map;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: CONTRACT_SHEET_SPREADSHEET_ID,
  });

  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === CONTRACT_SHEET_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) return map;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: CONTRACT_SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) return map;

  const headers = allRows[0].map(String);
  const poIdx = headers.findIndex(
    (h) => normalizeHeader(h) === "PO NO",
  );
  const attachmentIdx = headers.findIndex((h) =>
    normalizeHeader(h).includes("ATTACH"),
  );
  if (poIdx === -1 || attachmentIdx === -1) return map;

  for (const row of allRows.slice(1)) {
    const po = row[poIdx];
    const link = row[attachmentIdx];
    if (po === undefined || String(po).trim() === "") continue;
    if (link === undefined || String(link).trim() === "") continue;
    const key = normalizePo(String(po));
    if (!map.has(key)) map.set(key, String(link).trim());
  }

  return map;
}
