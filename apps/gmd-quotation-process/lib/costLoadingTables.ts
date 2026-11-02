import { prisma } from "@/lib/prisma";
import type { CostLoadingTables } from "./costLoading";

/** Reads the four add-on lookup tables the cost engine uses, so the table can show the loading %. */
export async function loadCostLoadingTables(): Promise<CostLoadingTables> {
  const [pt, insp, pbg, trans] = await Promise.all([
    prisma.paymentTermsCost.findMany({ select: { terms: true, costPct: true } }),
    prisma.inspectionCost.findMany({ select: { type: true, costPct: true } }),
    prisma.pbgCost.findMany({ select: { pbg: true, costPct: true } }),
    prisma.transportationCost.findMany({ select: { state: true, fullLoad: true, partLoad: true } }),
  ]);
  return {
    paymentTerms: Object.fromEntries(pt.map((r) => [r.terms, r.costPct])),
    inspection: Object.fromEntries(insp.map((r) => [r.type, r.costPct])),
    pbg: Object.fromEntries(pbg.map((r) => [r.pbg, r.costPct])),
    transport: Object.fromEntries(trans.map((r) => [r.state, { fullLoad: r.fullLoad, partLoad: r.partLoad }])),
  };
}
