import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SUPPLY_HISTORY_HEADERS,
  dbItemToRow,
} from "@/lib/gmd_lib/supply-history-columns";

const DISPLAY_HEADERS = <const>[
  "INVOICE NO",
  "item name",
  "FINANCIAL YEAR",
  "party name",
  "ERP PARTY NAME",
  "Date",
  "PARTY Order No.",
  "PARTY Date",
  "Quantity",
  "UOM",
  "Value",
  "Gross Total- INVOICE VALUE",
  "LR NO & DT",
  "DELIVERY DESTINATION",
  "CONSIGNEE ADDRESS",
  "CONSIGNEE NAME",
  "ERP CONTRACT NO",
  "ERP ITEM CODE",
  "TYPE OF VALVE",
  "SIZE OF VALVE",
  "CLASS OF VALVE",
  "SPARES (TYPE)",
  "MOC",
  "ORDER COPY",
  "INVOICE",
  "INSPECTION REPORT",
  "State",
  "UTILITY",
  "performance certificate",
  "service period complete",
  "WARRANTY VALID TILL AS PER CONTRACT",
  "Warranty valid/Not",
  "BG NO",
  "PBG VALID TILL",
  "as per order warranty period",
  "PBG CLAIM TILL",
  "PBG AMOUNT",
  "Warranty Exp Date as Per Inv",
  "Party Mail Address",
];

const displayColumnMap = DISPLAY_HEADERS.map(
  (h) => SUPPLY_HISTORY_HEADERS.indexOf(h),
);

export async function GET() {
  try {
    const items = await prisma.supplyHistoryItem.findMany({
      orderBy: { syncedAt: "desc" },
    });

    const lastSynced = items.length > 0
      ? items.reduce((latest: Date, item) => item.syncedAt > latest ? item.syncedAt : latest, items[0].syncedAt)
      : null;

    const rows = items.map(dbItemToRow).map((canonicalRow) =>
      displayColumnMap.map((idx) => canonicalRow[idx]),
    );

    return NextResponse.json({
      headers: DISPLAY_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
