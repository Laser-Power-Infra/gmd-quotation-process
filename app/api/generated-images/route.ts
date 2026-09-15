import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeImageKey } from "@/lib/imageKey";

export async function GET() {
  try {
    // 1) Distinct combos from EnquiryItem (source of truth for all valid triples)
    const distinctRows = await prisma.enquiryItem.findMany({
      // Prisma distinct on multiple fields returns distinct combinations
      distinct: ["itemType", "operationType", "rmType"],
      select: { itemType: true, operationType: true, rmType: true },
      where: {
        itemType: { not: null },
        operationType: { not: null },
        rmType: { not: null },
      },
    });

    // Filter to trimmed non-empty values (matches backfillImages.ts logic)
    const filtered = distinctRows.filter(
      (r) => r.itemType?.trim() && r.operationType?.trim() && r.rmType?.trim()
    ) as { itemType: string; operationType: string; rmType: string }[];

    // 2) Deduplicate by normalized imageKey (handles case/whitespace/+ ordering variations)
    const comboMap = new Map<string, { itemType: string; operationType: string; rmType: string }>();
    for (const r of filtered) {
      const key = makeImageKey(r.itemType, r.operationType, r.rmType);
      if (!comboMap.has(key)) {
        comboMap.set(key, {
          itemType: r.itemType.trim(),
          operationType: r.operationType.trim(),
          rmType: r.rmType.trim(),
        });
      }
    }

    // 3) Fetch all GeneratedImage rows (manual uploads only — AI generation removed)
    const generatedImages = await prisma.generatedImage.findMany({
      select: {
        id: true,
        itemType: true,
        operationType: true,
        rmType: true,
        imageKey: true,
        url: true,
        driveFileId: true,
        status: true,
        error: true,
        generatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const imageByKey = new Map<string, typeof generatedImages[number]>();
    for (const g of generatedImages) {
      imageByKey.set(g.imageKey, g);
    }

    // 4) Include any GeneratedImage orphans (imageKey not present in EnquiryItem combos)
    //    so manually added rows are never hidden
    for (const g of generatedImages) {
      if (!comboMap.has(g.imageKey)) {
        // Use stored values if available, otherwise fall back to parsing imageKey is not needed — just use stored
        const itemType = (g.itemType || "").trim();
        const operationType = (g.operationType || "").trim();
        const rmType = (g.rmType || "").trim();
        // Only add if we have at least displayable values; otherwise still show with placeholders
        if (!comboMap.has(g.imageKey)) {
          comboMap.set(g.imageKey, {
            itemType: itemType || g.itemType || "(unknown)",
            operationType: operationType || g.operationType || "(unknown)",
            rmType: rmType || g.rmType || "(unknown)",
          });
        }
      }
    }

    // 5) Build final items: one row per unique imageKey, enriched with GeneratedImage data if present
    const items = Array.from(comboMap.entries())
      .map(([imageKey, combo]) => {
        const g = imageByKey.get(imageKey) || null;
        return {
          itemType: combo.itemType,
          operationType: combo.operationType,
          rmType: combo.rmType,
          imageKey,
          generatedImageId: g?.id ?? null,
          url: g?.url ?? null,
          driveFileId: g?.driveFileId ?? null,
          status: g?.status ?? "pending",
          error: g?.error ?? null,
          generatedAt: g?.generatedAt ? g.generatedAt.toISOString() : null,
          createdAt: g?.createdAt ? g.createdAt.toISOString() : null,
          updatedAt: g?.updatedAt ? g.updatedAt.toISOString() : null,
          // helper: whether an uploaded image exists (only manual uploads count)
          hasImage: !!(g?.url || g?.driveFileId),
        };
      })
      .sort((a, b) => {
        // Sort: rows with images first? Or alphabetical. Keep alphabetical by itemType/operationType/rmType for stability
        const ax = `${a.itemType}|${a.operationType}|${a.rmType}`.toLowerCase();
        const bx = `${b.itemType}|${b.operationType}|${b.rmType}`.toLowerCase();
        return ax.localeCompare(bx);
      });

    return NextResponse.json({
      items,
      totalRows: items.length,
      totalWithImage: items.filter((i) => i.hasImage).length,
      totalPending: items.filter((i) => !i.hasImage).length,
    });
  } catch (error) {
    console.error("[generated-images] GET failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
