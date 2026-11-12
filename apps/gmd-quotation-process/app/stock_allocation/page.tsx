import type { Metadata } from "next";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import StockAllocationTable from "@gmd/stock-allocation/ui";
import { computeStockAllocation } from "@gmd/stock-allocation/server";
import { prisma } from "@/lib/prisma";
import * as actions from "./actions";

export const metadata: Metadata = { title: "Stock Allocation | GMD Quotation Process" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // Contract data is the only synced input: physical stock and bookings are entered by hand, so live.
  // null = never synced; a failed read is unknown (undefined), so the header shows no label.
  const contractSync = prisma.engineeringSync
    .findUnique({ where: { tabKey: "job:contract-review" }, select: { syncedAt: true } })
    .then(
      (row) => row?.syncedAt.toISOString() ?? null,
      (err) => {
        console.error("[stock-allocation] contract-review heartbeat read failed", err);
        return undefined;
      },
    );
  let result, error: string | null = null;
  try {
    result = await computeStockAllocation();
  } catch (err) {
    console.error("[stock-allocation] load failed", err);
    error = err instanceof Error ? err.message : String(err);
  }
  const syncedAt = await contractSync;
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div title="Contract data last synced">
        <GMDUpdateHeader title="STOCK ALLOCATION" totalRows={result?.offerNow.length ?? 0} syncedAt={syncedAt} />
      </div>
      <div className="flex-1 min-h-0 px-6 pb-6">
        {result ? (
          <StockAllocationTable initial={result} actions={{ ...actions }} />
        ) : (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">Could not load stock allocation: {error}</div>
        )}
      </div>
    </main>
  );
}
