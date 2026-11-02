import type { Metadata } from "next";
import { stockPrisma } from "@gmd/db-stock";
import { prisma } from "@/lib/prisma";
import { buildServiceOrders } from "@/lib/serviceOrders";
import ServiceOrdersTable from "@/components/service-orders/ServiceOrdersTable";

export const metadata: Metadata = {
  title: "Service / Work Orders | GMD One Person Lead Framework",
  description: "Open service and job-work orders, days pending and receipts pending.",
};

// Reads live data on every request, so render dynamically. pg + Prisma need Node.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const services = await prisma.serviceItem.findMany({ select: { itemCode: true, syncedAt: true } });
  const codes = services.map((s) => s.itemCode);
  const po = codes.length
    ? await stockPrisma.purchaseOrderLine.findMany({
        where: { itemCode: { in: codes, mode: "insensitive" } },
        select: {
          id: true, poNo: true, poLineNo: true, poDate: true, itemCode: true, itemName: true,
          supplierCode: true, supplierName: true, uom: true, netQtyOrder: true, qtyExecuted: true,
          balanceQty: true, rate: true, exchangeRate: true, deliverySched: true,
        },
      })
    : [];
  const grn = po.length
    ? await prisma.grnLine.findMany({
        where: { orderVrno: { in: [...new Set(po.map((p) => p.poNo))], mode: "insensitive" } },
        select: { vrno: true, vrdate: true, partybillno: true, orderVrno: true, orderSlno: true },
      })
    : [];

  const rows = buildServiceOrders(po, grn, new Set(codes), new Date());
  const syncedAt = services[0]?.syncedAt.toISOString() ?? null;

  return (
    <main className="h-[calc(100vh-64px)] overflow-hidden bg-background p-3">
      <ServiceOrdersTable rows={rows} syncedAt={syncedAt} serviceCodes={codes.length} />
    </main>
  );
}
