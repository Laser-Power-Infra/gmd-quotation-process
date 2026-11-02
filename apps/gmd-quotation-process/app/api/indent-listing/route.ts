import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { getMergedIndentListing } from "@/lib/indentListingRead";
import { prisma } from "@/lib/prisma";
import { VALVE_TYPES_BY_INDENT_ITEM } from "@/lib/indentItemValveTypes";
import {
  LIVE_RM_WHERE,
  RM_CODE_ITEM_CATEGORY,
  RM_CODE_VALVE_TYPES,
} from "@/lib/indentRmCodeResolver";

export const INDENT_LISTING_HEADERS = [
  "ITEM NAME",
  "SIZE",
  "PN RATING",
  "MC RECEIVED/PENDING",
  "TOTAL (BAL BILL AG CONT)",
  "V1",
  "V2",
  "V3",
  "V4",
  "V1 CATEGORY",
  "V2 CATEGORY",
  "V3 CATEGORY",
  "V4 CATEGORY",
  "RM CODE V1",
  "RM CODE V2",
  "RM CODE V3",
  "RM CODE V4",
] as const;

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const [data, rawMaterials] = await Promise.all([
      getMergedIndentListing(),
      // The same live raw-material set the resolver matches against, so the
      // hand-pick dropdown can only offer codes a sync could have picked.
      prisma.rawMaterial.findMany({
        where: {
          l8ItemCategory: {
            contains: RM_CODE_ITEM_CATEGORY,
            mode: "insensitive",
          },
          l2ValveType: {
            in: [
              ...new Set([
                ...RM_CODE_VALVE_TYPES,
                ...Object.values(VALVE_TYPES_BY_INDENT_ITEM).flat(),
              ]),
            ],
            mode: "insensitive",
          },
          ...LIVE_RM_WHERE,
        },
        select: {
          erpItemCode: true,
          itemNameDerived: true,
          itemNameAuto: true,
          l2ValveType: true,
          l3Dia: true,
        },
      }),
    ]);

    const rmOptions = rawMaterials
      .map((m) => ({
        code: (m.erpItemCode ?? "").trim(),
        name: (m.itemNameDerived ?? m.itemNameAuto ?? "").trim(),
        valveType: (m.l2ValveType ?? "").trim(),
        size: (m.l3Dia ?? "").trim(),
      }))
      .filter((o) => o.code !== "")
      .sort((a, b) => a.code.localeCompare(b.code));

    return NextResponse.json({
      headers: INDENT_LISTING_HEADERS,
      ...data,
      rmOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
