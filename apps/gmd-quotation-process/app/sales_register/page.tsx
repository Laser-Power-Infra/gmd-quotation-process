import type { Metadata } from "next";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import SalesRegisterTable from "@/components/execution/SalesRegisterTable";
import { getSalesLines } from "@/lib/executionPages-server";

export const metadata: Metadata = { title: "Sales Register | GMD Quotation Process" };
// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const { fy } = await searchParams;
  const data = await getSalesLines(fy);
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader title="SALES REGISTER" totalRows={data.lines.length} syncedAt={data.syncedAt} warnIfStale />
      <div className="flex-1 min-h-0 px-6 pb-6">
        <SalesRegisterTable key={data.fy} fy={data.fy} years={data.years} lines={data.lines} />
      </div>
    </main>
  );
}
