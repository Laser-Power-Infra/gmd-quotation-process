import { google } from "googleapis";

const SPREADSHEET_ID =
  process.env.SUPPLY_HISTORY_SPREADSHEET_ID;
const SHEET_NAME = "MASTER";

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

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:ZZZ`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    if (allRows.length === 0) {
      return Response.json({ headers: [], rows: [], totalRows: 0 });
    }

    const headers = allRows[0].map(String);
    const rows = allRows.slice(1).filter((r) =>
      r.some((c) => c !== null && c !== ""),
    );

    return Response.json({ headers, rows, totalRows: rows.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
