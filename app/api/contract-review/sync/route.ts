import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import {
  buildContractsColumnMap,
  buildDumpColumnMap,
  mapContractReviewRow,
} from "@/lib/gmd_lib/contract-review-columns";

const SPREADSHEET_ID = process.env.CONTRACT_SHEET_SPREADSHEET_ID;
const DUMP_GID = 0;
const CONTRACTS_GID = 451626558;

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

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export async function POST() {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error("CONTRACT_SHEET_SPREADSHEET_ID not configured");
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tabs =
      (meta.data.sheets ?? [])
        .map((s) => ({
          title: s.properties?.title ?? "",
          gid: s.properties?.sheetId,
        }));

    const contractsTab = tabs.find((t) => t.gid === CONTRACTS_GID);
    const dumpTab = tabs.find((t) => t.gid === DUMP_GID);
    if (!contractsTab || !dumpTab) {
      throw new Error("Required tabs not found in the spreadsheet");
    }

    const contractsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${contractsTab.title}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const contractsAll = contractsRes.data.values ?? [];
    const contractsHeaders = (contractsAll[3] ?? []).map(String);
    const contractsColumnMap = buildContractsColumnMap(contractsHeaders);
    const contractsRows = contractsAll.slice(4);

    const dumpRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${dumpTab.title}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const dumpAll = dumpRes.data.values ?? [];
    const dumpHeaders = (dumpAll[0] ?? []).map(String);
    const dumpColumnMap = buildDumpColumnMap(dumpHeaders);
    const dumpRows = dumpAll.slice(1);

    const contractsByKey = new Map<string, unknown[]>();
    for (const row of contractsRows) {
      const itemCode = String(row[contractsColumnMap[2]] ?? "").trim();
      const contractNo = String(row[contractsColumnMap[0]] ?? "").trim();
      if (!itemCode || !contractNo) continue;
      const key = normalizeKey(itemCode) + "||" + normalizeKey(contractNo);
      if (!contractsByKey.has(key)) contractsByKey.set(key, row);
    }

    const dumpByKey = new Map<string, unknown[]>();
    for (const row of dumpRows) {
      const itemCode = String(row[4] ?? "").trim();
      const contractNo = String(row[2] ?? "").trim();
      if (!itemCode || !contractNo) continue;
      const key = normalizeKey(itemCode) + "||" + normalizeKey(contractNo);
      if (!dumpByKey.has(key)) dumpByKey.set(key, row);
    }

    const syncedAt = new Date();

    let upserted = 0;
    for (const [key, contractRow] of contractsByKey) {
      const dumpRow = dumpByKey.get(key) ?? null;
      const mapped = mapContractReviewRow(
        contractRow,
        dumpRow,
        contractsColumnMap,
        dumpColumnMap,
      );

      const update = { ...mapped, syncedAt };

      await prisma.contractReview.upsert({
        where: {
          itemCode_contractNo: {
            itemCode: mapped.itemCode,
            contractNo: mapped.contractNo,
          },
        },
        update,
        create: update,
      });
      upserted++;
    }

    return NextResponse.json({
      count: upserted,
      totalInContracts: contractsByKey.size,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
