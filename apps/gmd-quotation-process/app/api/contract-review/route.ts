import { denyIfNoAccess } from "@/lib/access";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { after, NextResponse } from "next/server";
import {
  loadContractReviewItems,
  toContractReviewData,
} from "@gmd/contract-review/server";
import {
  getBatchDistinctBomIds,
  getBomRmAvailBatch,
  computeContractReviewRmAvail,
} from "@/lib/verifyBomLookup";
import { getContractReviewImagesByItemCode } from "@/lib/gmd_lib/contract-review-image-lookup";
import { normalizeContractKey } from "@/lib/gmd_lib/contract-review-enquiry-backfill";

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const items = await loadContractReviewItems();

    const withBom = items.filter((i) => i.bomId);
    const bomIds = [
      ...new Set(withBom.map((i) => i.bomId).filter((b): b is string => !!b)),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const noUseUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        tenderPrisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    // The displayed value is already corrected in memory below, so persisting
    // the changed rows doesn't need to block the response.
    if (noUseUpdates.length > 0) {
      after(async () => {
        try {
          await tenderPrisma.$transaction(noUseUpdates, { timeout: 30_000 });
        } catch (error) {
          console.error("contract-review noUse persist failed", error);
        }
      });
    }
    for (const item of items) {
      if (item.bomId) item.noUse = availMap.get(item.id) ?? null;
    }

    const codes = [...new Set(items.map((i) => i.itemCode).filter(Boolean))];
    // Images are keyed by itemType/operationType/rmType, not by item code, so
    // they resolve through EnquiryItem.erpItemCode. Keyed here by the raw
    // itemCode so the client can look up with the cell value as-is.
    const [bomMap, imagesByNormalizedCode] = await Promise.all([
      getBatchDistinctBomIds(codes),
      getContractReviewImagesByItemCode(codes),
    ]);
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) {
      bomIdOptions[item.id] = bomMap.get(item.itemCode) ?? [];
    }
    const itemImages: Record<
      string,
      {
        imageKey: string;
        url: string | null;
        driveFileId: string | null;
        itemType: string | null;
        operationType: string | null;
        rmType: string | null;
      }[]
    > = {};
    for (const item of items) {
      const matches =
        imagesByNormalizedCode.get(normalizeContractKey(item.itemCode)) ?? [];
      if (matches.length === 0) continue;
      itemImages[item.itemCode] = matches;
    }

    return NextResponse.json({
      ...toContractReviewData(items),
      bomIdOptions,
      itemImages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
