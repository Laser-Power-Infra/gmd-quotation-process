import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseNum(value: unknown): number {
  let s = String(value ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/^["']+|["']+$/g, "").replace(/,/g, "");
  return parseFloat(s);
}

export async function POST() {
  try {
    const source = await prisma.contractReview.findMany({
      select: {
        item: true,
        size: true,
        pnRating: true,
        mcReceivedPending: true,
        balBillAgCont: true,
      },
    });
    console.log(
      `[indent-listing-sync] Source ContractReview rows: ${source.length}`,
    );

    const groups = new Map<
      string,
      {
        item: string | null;
        size: string | null;
        pnRating: string | null;
        mcReceivedPending: string;
        sum: number;
      }
    >();
    for (const row of source) {
      const status = String(row.mcReceivedPending ?? "").trim();
      const statusUpper = status.toUpperCase();
      if (statusUpper !== "RECEIVED" && statusUpper !== "PENDING") continue;

      const item = row.item?.trim() || null;
      const size = row.size?.trim() || null;
      const pnRating = row.pnRating?.trim() || null;

      const key = [
        normalizeKey(item),
        normalizeKey(size),
        normalizeKey(pnRating),
        statusUpper,
      ].join("||");

      const existing = groups.get(key);
      const value = parseNum(row.balBillAgCont);
      if (existing) {
        if (!isNaN(value)) existing.sum += value;
      } else {
        groups.set(key, {
          item,
          size,
          pnRating,
          mcReceivedPending: status,
          sum: isNaN(value) ? 0 : value,
        });
      }
    }

    const existingRows = await prisma.indentListing.findMany();
    const existingByKey = new Map(
      existingRows.map((r) => [
        [
          normalizeKey(r.item),
          normalizeKey(r.size),
          normalizeKey(r.pnRating),
          normalizeKey(r.mcReceivedPending),
        ].join("||"),
        r,
      ]),
    );

    const syncedAt = new Date();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const createdKeys: string[] = [];
    const changedDetails: { key: string; old: number | null; next: number }[] = [];

    for (const [key, group] of groups) {
      const existing = existingByKey.get(key);
      if (!existing) {
        await prisma.indentListing.create({
          data: {
            item: group.item,
            size: group.size,
            pnRating: group.pnRating,
            mcReceivedPending: group.mcReceivedPending,
            totalBalBillAgCont: group.sum,
            syncedAt,
          },
        });
        created++;
        createdKeys.push(key);
        continue;
      }

      // Update only when the new total is a real value; never blank out or
      // zero an existing non-null total. v1..v4 are UI-managed and preserved.
      const data: { totalBalBillAgCont?: number; syncedAt: Date } = { syncedAt };
      const oldTotal = existing.totalBalBillAgCont;
      if (
        existing.totalBalBillAgCont == null ||
        (group.sum !== 0 && !isNaN(group.sum))
      ) {
        data.totalBalBillAgCont = group.sum;
      }

      const nextTotal = data.totalBalBillAgCont;
      const realChange =
        nextTotal !== undefined &&
        (existing.totalBalBillAgCont == null ||
          Number(existing.totalBalBillAgCont) !== nextTotal);

      if (realChange) {
        await prisma.indentListing.update({
          where: { id: existing.id },
          data,
        });
        updated++;
        changedDetails.push({
          key,
          old: oldTotal,
          next: nextTotal as number,
        });
      } else {
        // No data change — just touch syncedAt so the dashboard shows a fresh
        // sync time. Not counted as an update.
        await prisma.indentListing.update({
          where: { id: existing.id },
          data: { syncedAt },
        });
        unchanged++;
      }
    }

    console.log(
      `[indent-listing-sync] Groups: ${groups.size} | created=${created} updated=${updated} unchanged=${unchanged}`,
    );
    if (createdKeys.length > 0) {
      console.log(`[indent-listing-sync] Created keys:\n  ${createdKeys.join("\n  ")}`);
    }
    if (changedDetails.length > 0) {
      console.log(
        `[indent-listing-sync] Updated totals (old -> next):\n  ${changedDetails
          .map((c) => `${c.key}: ${c.old ?? "null"} -> ${c.next}`)
          .join("\n  ")}`,
      );
    }

    const reason =
      groups.size === 0
        ? "No Contract Review rows with RECEIVED/PENDING status to sync."
        : created === 0 && updated === 0
          ? `All ${unchanged} existing indent rows are already up to date (no total changes).`
          : undefined;

    return NextResponse.json({
      created,
      updated,
      unchanged,
      total: groups.size,
      reason,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[indent-listing-sync] Failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}