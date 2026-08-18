import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  SUPPLY_HISTORY_HEADERS,
  buildColumnMap,
  mapSheetRowToDb,
} from "@/lib/gmd_lib/supply-history-columns";
import {
  buildContractOrderLinkMap,
  matchOrderLink,
} from "@/lib/gmd_lib/contract-order-links";

const SPREADSHEET_ID = process.env.SUPPLY_HISTORY_SPREADSHEET_ID;
const SHEET_NAME = "MASTER";

function getAuth() {
  return getOAuthClient();
}

export async function POST() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    if (allRows.length < 2) {
      return NextResponse.json({ count: 0, syncedAt: new Date().toISOString() });
    }

    const sheetHeaders = allRows[0].map(String);
    const columnMap = buildColumnMap(sheetHeaders);

    const syncedAt = new Date();
    const rawRows = allRows.slice(1).filter((r) =>
      r.some((c) => c !== null && c !== ""),
    );

    // await prisma.supplyHistoryItem.deleteMany();

    let contractLinkMap: Map<string, string>;
    try {
      contractLinkMap = await buildContractOrderLinkMap();
    } catch (err) {
      console.error("Failed to load contract order links:", err);
      contractLinkMap = new Map();
    }

    let upserted = 0;
    for (const rawRow of rawRows) {
      const mapped = mapSheetRowToDb(rawRow, columnMap, syncedAt);

      if (!mapped.itemName || !mapped.invoiceNo) continue;

      mapped.orderList = matchOrderLink(mapped.partyOrderNo, contractLinkMap);

      await prisma.supplyHistoryItem.upsert({
        where: {
          invoiceNo_itemName: {
            invoiceNo: mapped.invoiceNo,
            itemName: mapped.itemName,
          },
        },
        update: {
          financialYear: mapped.financialYear,
          partyName: mapped.partyName,
          erpPartyName: mapped.erpPartyName,
          date: mapped.date,
          partyOrderNo: mapped.partyOrderNo,
          partyDate: mapped.partyDate,
          quantity: mapped.quantity,
          uom: mapped.uom,
          value: mapped.value,
          grossTotalInvoiceValue: mapped.grossTotalInvoiceValue,
          lrNoDt: mapped.lrNoDt,
          deliveryDestination: mapped.deliveryDestination,
          consigneeAddress: mapped.consigneeAddress,
          consigneeName: mapped.consigneeName,
          erpContractNo: mapped.erpContractNo,
          erpItemCode: mapped.erpItemCode,
          typeOfValve: mapped.typeOfValve,
          sizeOfValve: mapped.sizeOfValve,
          classOfValve: mapped.classOfValve,
          sparesType: mapped.sparesType,
          moc: mapped.moc,
          orderCopy: mapped.orderCopy,
          invoice: mapped.invoice,
          inspectionReport: mapped.inspectionReport,
          state: mapped.state,
          utility: mapped.utility,
          performanceCertificate: mapped.performanceCertificate,
          servicePeriodComplete: mapped.servicePeriodComplete,
          warrantyValidTillAsPerContract: mapped.warrantyValidTillAsPerContract,
          warrantyValidNot: mapped.warrantyValidNot,
          bgNo: mapped.bgNo,
          pbgValidTill: mapped.pbgValidTill,
          asPerOrderWarrantyPeriod: mapped.asPerOrderWarrantyPeriod,
          pbgClaimTill: mapped.pbgClaimTill,
          pbgAmount: mapped.pbgAmount,
          warrantyExpDateAsPerInv: mapped.warrantyExpDateAsPerInv,
          partyMailAddress: mapped.partyMailAddress,
          orderList: mapped.orderList,
          syncedAt,
        },
        create: mapped,
      });
      upserted++;
    }

    return NextResponse.json({
      count: upserted,
      totalInSheet: rawRows.length,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
