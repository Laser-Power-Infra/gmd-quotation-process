import type { Metadata } from "next";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import ReadyToBillTable from "@/components/execution/ReadyToBillTable";
import { getContractLines } from "@/lib/executionPages-server";

export const metadata: Metadata = { title: "Ready to Bill | GMD Quotation Process" };
// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { lines, syncedAt } = await getContractLines();
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader title="READY TO BILL" totalRows={lines.filter((l) => l.balBillAgMc > 0).length} syncedAt={syncedAt} warnIfStale />
      <div className="flex-1 min-h-0 px-6 pb-6">
        <ReadyToBillTable lines={lines} />
      </div>
    </main>
  );
}
