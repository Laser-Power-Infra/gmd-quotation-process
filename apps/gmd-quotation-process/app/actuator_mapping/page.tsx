import type { Metadata } from "next";
import { stockPrisma } from "@gmd/db-stock";
import { prisma } from "@/lib/prisma";
import { mismatchReport } from "@/lib/actuatorStock";
import ActuatorMappingView from "@/components/actuator-mapping/ActuatorMappingView";

export const metadata: Metadata = {
  title: "Actuator & Gearbox Mapping | GMD Quotation Process",
  description: "Valve type, size and pressure mapped to gearbox and actuator, with live stock.",
};

// Live stock is read on every request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const qtyOf = (v: string | null) => {
  const n = parseFloat((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

export default async function Page() {
  const [mappings, suitability, actStock, gbStock] = await Promise.all([
    prisma.actuatorMapping.findMany(),
    prisma.actuatorSuitability.findMany(),
    prisma.actuatorStock.findMany({ select: { erpCode: true, ratingCode: true, series: true, make: true, torque: true, actCode: true, available: true, physicalSum: true, stockPerErp: true, stockValue: true, status: true }, orderBy: [{ make: "asc" }, { erpCode: "asc" }] }),
    prisma.gmdGearboxStock.findMany({ select: { erpCode: true, gbType: true, ratedTorque: true, available: true, stockPerErp: true, remarks: true }, orderBy: { erpCode: "asc" } }),
  ]);

  // Live available qty per ERP code (Physical Stock can have several lines per code: sum them).
  const codes = [...new Set([...actStock.map((a) => a.erpCode), ...gbStock.map((g) => g.erpCode), ...mappings.map((m) => m.gmdGbCode ?? "")])].filter(Boolean);
  const live = new Map<string, number>();
  let stockError: string | null = null;
  try {
    const rows = await stockPrisma.physicalStock.findMany({ where: { erp_code: { in: codes } }, select: { erp_code: true, available_qty: true } });
    for (const r of rows) live.set(r.erp_code!, (live.get(r.erp_code!) ?? 0) + qtyOf(r.available_qty));
  } catch (err) {
    console.error("[actuator-mapping] live stock read failed", err);
    stockError = "Live stock could not be read. Quantities are not shown.";
  }

  // Qty per actuator code / gearbox code / Rotork K-series rating, all from live stock.
  const qtyByCode: Record<string, number> = {};
  const rotorkQtyByNm: Record<string, number> = {};
  for (const a of actStock) {
    const q = live.get(a.erpCode) ?? 0;
    if (a.actCode) qtyByCode[a.actCode] = (qtyByCode[a.actCode] ?? 0) + q;
    if (a.make === "Rotork" && a.torque !== null) rotorkQtyByNm[a.torque] = (rotorkQtyByNm[a.torque] ?? 0) + q;
  }
  for (const g of gbStock) qtyByCode[g.erpCode] = live.get(g.erpCode) ?? 0;
  const gbQty: Record<string, number> = Object.fromEntries(mappings.filter((m) => m.gmdGbCode).map((m) => [m.gmdGbCode!, live.get(m.gmdGbCode!) ?? 0]));

  // ERP vs physical uses the workbook snapshot (live Physical Stock is read for available qty only).
  const report = mismatchReport(actStock, gbStock);
  const withLive = <T extends { erpCode: string }>(r: T) => ({ ...r, live: stockError ? null : live.get(r.erpCode) ?? 0 });

  return (
    <main className="h-[calc(100vh-64px)] overflow-hidden bg-background p-3">
      <ActuatorMappingView
        mappings={mappings.map(({ updatedAt: _u, ...m }) => m)}
        suitability={suitability}
        qtyByCode={{ ...qtyByCode, ...gbQty }}
        rotorkQtyByNm={rotorkQtyByNm}
        stockLines={[
          ...actStock.map((a) => ({ kind: "Actuator", erpCode: a.erpCode, make: a.make, ratingCode: a.ratingCode, series: a.series, torque: a.torque, qty: stockError ? null : live.get(a.erpCode) ?? 0 })),
          ...gbStock.map((g) => ({ kind: "Gearbox", erpCode: g.erpCode, make: "GMD", ratingCode: g.gbType, series: null, torque: g.ratedTorque, qty: stockError ? null : live.get(g.erpCode) ?? 0 })),
        ]}
        stockError={stockError}
        report={{
          totals: report.totals,
          erpMismatch: report.erpMismatch.map(withLive),
          gearboxCoded: report.gearboxCoded.map(withLive),
          gearboxNeedsCode: report.gearboxNeedsCode,
          aumaToFill: report.aumaToFill.map(withLive),
        }}
      />
    </main>
  );
}
