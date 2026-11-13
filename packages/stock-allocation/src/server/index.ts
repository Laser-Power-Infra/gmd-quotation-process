import "server-only";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { stockPrisma } from "@gmd/db-stock";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { allocateStock } from "../engine";
import { readyToBillFacet, readyToBillPage, type ReadyToBillPageData } from "../readyToBill";
import { listLedger } from "./ledger";
import type { AllocationResult, ContractLine, LedgerEntry, StockItem } from "../types";

const num = (v: string | null) => {
  const n = parseFloat((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const done = (v: string | null) => ((v ?? "").trim().toUpperCase() === "DONE" ? "DONE" : "PENDING");

export async function computeStockAllocation(): Promise<AllocationResult> {
  const [rows, stockRows, ledger] = await Promise.all([
    // ordered by id: ties in the engine (same contract date, equal candidates) must not follow DB row order
    tenderPrisma.contractReview.findMany({
      where: { OR: [{ status: null }, { status: "" }], clearanceStatus: "APPROVED", mcReceivedPending: "Received" },
      select: {
        id: true, contractNo: true, partyNameDump: true, erpPartyNameFromGmdSupplyHistory: true, poNo: true,
        projectReference: true, dateOfContract: true, itemCode: true, itemName: true, item: true, size: true,
        pnRating: true, actuator: true, rate: true, balBillAgCont: true, inspection: true, offerPendingDone: true,
      },
      orderBy: { id: "asc" },
    }),
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
  ]);

  const lines: ContractLine[] = rows.map((r) => ({
    id: r.id, contractNo: r.contractNo,
    party: r.partyNameDump || r.erpPartyNameFromGmdSupplyHistory || "-",
    poNo: r.poNo, project: r.projectReference, dateOfContract: r.dateOfContract,
    itemCode: r.itemCode, itemName: r.itemName ?? "", item: r.item, size: r.size, pnRating: r.pnRating,
    actuator: r.actuator, rate: num(r.rate), balanceQty: num(r.balBillAgCont),
    inspection: done(r.inspection), offer: done(r.offerPendingDone),
  }));
  const stock: StockItem[] = stockRows.map((s) => ({
    id: s.id, erpCode: s.erp_code ?? "", location: s.location, valveType: s.l2_valve_type, dimension: s.dimension,
    component: s.l4_component, material: s.l5_material, std: s.l6_std, pn: s.l7_dimension,
    category: s.l8_item_category, itemType: s.item_type, availableQty: num(s.available_qty),
  }));
  return allocateStock({ stock, lines, ledger });
}

// shortcut: the engine runs on every call (each page, facet and CSV page); cache its result per request if it gets slow.
/** One page of Ready to Bill: the engine's Offer Now lines, filtered, sorted and totalled here so the browser holds one page. */
export async function listReadyToBillPage(query: TableQuery): Promise<ReadyToBillPageData> {
  return readyToBillPage((await computeStockAllocation()).offerNow, query);
}

export async function listReadyToBillFacet(key: string, query: TableQuery): Promise<string[]> {
  return readyToBillFacet((await computeStockAllocation()).offerNow, key, query);
}

export * from "./ledger";
