import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { computeStockAllocation } from "@gmd/stock-allocation/server";
import { prisma } from "@/lib/prisma";
import { stockPrisma } from "@/lib/stockPrisma";
import { seedTeamFromInspector, type OfferedStock, type ReportData } from "@/lib/inspectionReport";
import { ReportEditor } from "./report-editor";

export const metadata: Metadata = {
  title: "Inspection Report | GMD One Person Lead Framework",
};

export const dynamic = "force-dynamic";

/** Stock the allocation sets against this contract's lines, without actuators / gear boxes; null when it cannot be read or the contract no. is blank. */
async function offeredStock(contractNo: string): Promise<OfferedStock[] | null> {
  const key = contractNo.trim().toUpperCase();
  // Not [], which would read as "No stock allocated" on every item.
  if (!key) return null;
  try {
    // shortcut: runs the whole allocation for one contract, as the stock allocation page does; cache it if this page gets slow.
    const mine = (await computeStockAllocation()).allocations.filter(
      (a) => a.contractNo.trim().toUpperCase() === key && a.stage !== "Dispatched",
    );
    const rows = await stockPrisma.physicalStock.findMany({
      where: { id: { in: mine.map((a) => a.stockId) } },
      select: { id: true, l2_valve_type: true, l8_item_category: true, l7_dimension: true, dimension: true, l5_material: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return mine.flatMap((a) => {
      const r = byId.get(a.stockId);
      // Actuators and gear boxes are fitted to the valve; the valve row carries the PN / size / material.
      if (!r || /ACTUATOR|GEAR ?BOX/i.test(`${r.l2_valve_type ?? ""} ${r.l8_item_category ?? ""}`)) return [];
      return [{
        itemCode: a.itemCode, erpCode: a.erpCode, qty: a.qty,
        pn: r.l7_dimension ?? "", size: r.dimension ?? "", material: r.l5_material ?? "",
      }];
    });
  } catch (err) {
    console.error("[inspection-report] stock allocation failed", err);
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.inspectionReport.findUnique({
    where: { id },
    include: { offer: { select: { vrno: true } } },
  });
  if (!report) notFound();
  const data = seedTeamFromInspector(report.data as ReportData);

  return (
    <main className="h-[calc(100vh-64px)] overflow-auto bg-background p-3">
      <ReportEditor
        id={report.id}
        offerNo={report.offer.vrno}
        initialStatus={report.status}
        initialData={data}
        offered={await offeredStock(data.header.contractNo)}
      />
    </main>
  );
}
