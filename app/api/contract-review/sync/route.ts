import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  buildContractsColumnMap,
  buildDumpColumnMap,
  mapContractReviewRow,
} from "@/lib/gmd_lib/contract-review-columns";
import { getBomUseStatusBatch } from "@/lib/verifyBomLookup";

const SPREADSHEET_ID = process.env.CONTRACT_SHEET_SPREADSHEET_ID;
const DUMP_GID = 0;
const CONTRACTS_GID = 451626558;

function getAuth() {
  return getOAuthClient();
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
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
    let patched = 0;
    for (const [key, contractRow] of contractsByKey) {
      const dumpRow = dumpByKey.get(key) ?? null;
      const mapped = mapContractReviewRow(
        contractRow,
        dumpRow,
        contractsColumnMap,
        dumpColumnMap,
      );

      const existing = await prisma.contractReview.findFirst({
        where: {
          itemCode: mapped.itemCode,
          contractNo: mapped.contractNo,
        },
      });
      if (!existing) {
        await prisma.contractReview.create({ data: { ...mapped, syncedAt } });
        upserted++;
        continue;
      }

      // Strict Mode A: preserve any existing non-null/ non-empty value; only fill gaps from sheet
      const filtered: Record<string, unknown> = { syncedAt };
      let hasDataChange = false;
      for (const [field, sheetVal] of Object.entries(mapped)) {
        if (field === "contractNo" || field === "itemCode") continue; // keys immutable
        const dbVal = (existing as unknown as Record<string, unknown>)[field];
        if (isNullOrEmpty(dbVal) && !isNullOrEmpty(sheetVal)) {
          (filtered as Record<string, unknown>)[field] = sheetVal;
          hasDataChange = true;
        }
      }

      if (hasDataChange) {
        await prisma.contractReview.update({
          where: { id: existing.id },
          data: filtered,
        });
        patched++;
      } else {
        // No data gaps to fill, still bump syncedAt to record sync time
        await prisma.contractReview.update({
          where: { id: existing.id },
          data: { syncedAt },
        });
      }
      upserted++;
    }

    const withBom = await prisma.contractReview.findMany({
      where: { bomId: { not: null } },
      select: { id: true, bomId: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        withBom.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const statusMap = await getBomUseStatusBatch(bomIds);
    const noUseUpdates = withBom
      .map((i) => {
        const status = i.bomId ? (statusMap.get(i.bomId) ?? "") : null;
        return { i, status };
      })
      .filter(({ i, status }) => status !== i.noUse)
      .map(({ i, status }) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: status },
        }),
      );
    if (noUseUpdates.length > 0) {
      await prisma.$transaction(noUseUpdates);
    }

    return NextResponse.json({
      count: upserted,
      patched,
      totalInContracts: contractsByKey.size,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
