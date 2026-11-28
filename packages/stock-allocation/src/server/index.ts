import "server-only";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { stockPrisma } from "@gmd/db-stock";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { allocateStock } from "../engine";
import { inspectionCallList, readyToBillExport, readyToBillFacet, readyToBillPage, type ExportRows, type ReadyToBillPageData } from "../readyToBill";
import { loadPurchase } from "./purchaseLoad";
import { listLedger } from "./ledger";
import type { AllocationResult, ContractLine, InputsLoader, LedgerEntry, StockItem } from "../types";

/** null when blank or not a number. */
const qty = (v: string | null) => {
  const n = parseFloat((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};
const num = (v: string | null) => qty(v) ?? 0;
const done = (v: string | null) => ((v ?? "").trim().toUpperCase() === "DONE" ? "DONE" : "PENDING");

/**
 * Live Contract Review lines (MC received, then MC pending), physical stock and the ledger, through the engine.
 * `loadInputs` is the host app's reader of offered qty, BOM parts and China shipments for those lines.
 */
export async function computeStockAllocation(loadInputs?: InputsLoader): Promise<AllocationResult> {
  // ordered by id: ties in the engine (same date, equal candidates) must not follow DB row order
  const lines = tenderPrisma.contractReview.findMany({
    where: {
      OR: [{ status: null }, { status: "" }], clearanceStatus: "APPROVED",
      mcReceivedPending: { in: ["Received", "Pending"], mode: "insensitive" },
    },
    select: {
      id: true, contractNo: true, partyNameDump: true, erpPartyNameFromGmdSupplyHistory: true, poNo: true,
      projectReference: true, dateOfContract: true, itemCode: true, itemName: true, partyItemName: true, item: true, size: true,
      pnRating: true, actuator: true, rate: true, balBillAgCont: true, inspection: true, offerPendingDone: true,
      mcReceivedPending: true, mcNo: true, mcDate: true, mcQty: true, billedQty: true, state: true, rmCodeForGb: true, bomId: true,
    },
    orderBy: { id: "asc" },
  }).then((rows) => rows.map((r): ContractLine => ({
    id: r.id, contractNo: r.contractNo,
    party: r.partyNameDump || r.erpPartyNameFromGmdSupplyHistory || "-",
    poNo: r.poNo, project: r.projectReference, dateOfContract: r.dateOfContract,
    itemCode: r.itemCode, itemName: r.itemName ?? "", partyItemName: r.partyItemName, item: r.item, size: r.size, pnRating: r.pnRating,
    actuator: r.actuator, rate: num(r.rate), balanceQty: num(r.balBillAgCont),
    inspection: done(r.inspection), offer: done(r.offerPendingDone),
    mcPending: r.mcReceivedPending?.toUpperCase() === "PENDING", mcNo: r.mcNo, mcDate: r.mcDate, mcQty: qty(r.mcQty),
    billedQty: num(r.billedQty), state: r.state, rmCodeForGb: r.rmCodeForGb, bomId: r.bomId,
  })));
  const [contractLines, stockRows, ledger, inputs] = await Promise.all([
    lines,
    stockPrisma.physicalStock.findMany({
      select: {
        id: true, erp_code: true, location: true, l2_valve_type: true, dimension: true, l4_component: true, l5_material: true,
        l6_std: true, l7_dimension: true, l8_item_category: true, item_type: true, available_qty: true,
      },
      orderBy: { id: "asc" },
    }),
    // Table is missing until the db-stock migration is deployed: carry on without a ledger.
    listLedger().catch((err): LedgerEntry[] => {
      console.error("[stock-allocation] ledger read failed", err);
      return [];
    }),
    // like the ledger: a failed read runs the rules without offered qty, RM route and incoming
    lines.then((l) => loadInputs?.(l).catch((err): undefined => {
      console.error("[stock-allocation] host inputs read failed", err);
      return undefined;
    })),
  ]);

  const stock: StockItem[] = stockRows.map((s) => ({
    id: s.id, erpCode: s.erp_code ?? "", location: s.location, valveType: s.l2_valve_type, dimension: s.dimension,
    component: s.l4_component, material: s.l5_material, std: s.l6_std, pn: s.l7_dimension,
    category: s.l8_item_category, itemType: s.item_type, availableQty: num(s.available_qty),
  }));
  const liveKeys = new Set(contractLines.filter((l) => l.balanceQty > 0).map((l) => `${l.contractNo}|${l.itemCode}`));
  const purchase = await loadPurchase((a) => liveKeys.has(`${a.contractNo}|${a.itemCode}`));
  // free pending from purchase lines replaces the host's incoming (CHINA SHIPMENTS); a non-empty host list still wins
  const incoming = inputs?.incoming?.length ? inputs.incoming : purchase.incoming;
  const result = allocateStock({ stock, lines: contractLines, ledger, ...inputs, incoming, purchaseAllocations: purchase.purchaseAllocations });
  return { ...result, purchaseLines: purchase.views };
}

// shortcut: the engine runs on every call (each page, facet and download); cache its result per request if it gets slow.
/** One page of Ready to Bill: the engine's Offer Now lines, filtered, sorted and totalled here so the browser holds one page. */
export async function listReadyToBillPage(query: TableQuery, loadInputs?: InputsLoader): Promise<ReadyToBillPageData> {
  const { offerNow, lines } = await computeStockAllocation(loadInputs);
  return readyToBillPage(offerNow, query, lines);
}

export async function listReadyToBillFacet(key: string, query: TableQuery, loadInputs?: InputsLoader): Promise<string[]> {
  const { offerNow, lines } = await computeStockAllocation(loadInputs);
  return readyToBillFacet(offerNow, key, query, lines);
}

/** The internal download, built here from every line under the query. */
export async function listReadyToBillExport(query: TableQuery, loadInputs?: InputsLoader): Promise<ExportRows> {
  const { offerNow, lines } = await computeStockAllocation(loadInputs);
  return readyToBillExport(offerNow, query, lines);
}

/** The inspection call list for sharing outside, built here from every line under the query. */
export async function listInspectionCallList(query: TableQuery, loadInputs?: InputsLoader): Promise<ExportRows> {
  const { offerNow, lines } = await computeStockAllocation(loadInputs);
  return inspectionCallList(offerNow, query, lines);
}

export * from "./ledger";
export * from "./purchaseLedger";
