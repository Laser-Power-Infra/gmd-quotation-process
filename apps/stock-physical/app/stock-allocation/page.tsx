import type { Metadata } from "next";
import StockAllocationTable from "@gmd/stock-allocation/ui";
import { computeStockAllocation } from "@gmd/stock-allocation/server";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Stock Allocation | Stock Physical Dashboard",
};

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let result, error: string | null = null;
  try {
    result = await computeStockAllocation();
  } catch (err) {
    console.error("[stock-allocation] load failed", err);
    error = err instanceof Error ? err.message : String(err);
  }
  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 px-6 py-4">
        {result ? (
          <StockAllocationTable initial={result} actions={{ ...actions }} hideRates />
        ) : (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">Could not load stock allocation: {error}</div>
        )}
      </div>
    </main>
  );
}
