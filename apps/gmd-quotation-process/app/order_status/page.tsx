import type { Metadata } from "next";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import OrderStatusTable from "@/components/execution/OrderStatusTable";
import { getContractLines } from "@/lib/executionPages-server";

export const metadata: Metadata = { title: "Order Status | GMD Quotation Process" };
// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { lines, syncedAt } = await getContractLines();
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader title="ORDER STATUS" totalRows={lines.length} syncedAt={syncedAt} warnIfStale />
      <div className="flex-1 min-h-0 px-6 pb-6">
        <OrderStatusTable lines={lines} />
      </div>
    </main>
  );
}
