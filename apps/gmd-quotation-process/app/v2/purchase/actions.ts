"use server";
import { requireAccess } from "@/lib/access";
import { getSupplierPayables } from "@/lib/creditors-server";
import { prisma } from "@/lib/prisma";
import { listPurchaseFacet, listPurchaseLines, listPurchasePoPage } from "@gmd/purchase/server";
import type { PoLine, PurchasePageData, PurchaseQuery } from "@gmd/purchase/po-columns";
import { BLANK } from "@gmd/ui/components/data-table/types";

// Purchases v2 is read-only. Access is checked here: the package has no notion
// of this app's sessions. Purchase lines live in the stock DB; supplier payables
// (Creditors) and the party of a sales contract (Contract Review) live in the
// quotation DB, so both are joined here.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    await requireAccess();
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A contract filter value no purchase line carries: selects nothing. */
const NO_CONTRACT = "\u0000";

const withoutParty = (query: PurchaseQuery): PurchaseQuery => {
  const { party: _party, ...filters } = query.filters;
  return { ...query, filters };
};

async function contractsOfParties(parties: string[]): Promise<string[]> {
  const rows = await prisma.contractReview.findMany({ where: { partyNameDump: { in: parties } }, select: { contractNo: true }, distinct: ["contractNo"] });
  return rows.map((r) => r.contractNo.trim().toUpperCase());
}

/** The Party slicer becomes a sales-contract filter the purchase SQL understands. */
async function resolveParty(query: PurchaseQuery): Promise<PurchaseQuery> {
  const parties = query.filters.party;
  if (!parties?.length) return query;
  const picked = query.filters.contract;
  const contracts = (await contractsOfParties(parties)).filter((c) => !picked?.length || picked.includes(c));
  return { ...withoutParty(query), filters: { ...withoutParty(query).filters, contract: contracts.length ? contracts : [NO_CONTRACT] } };
}

export async function loadPage(query: PurchaseQuery): Promise<Result<PurchasePageData>> {
  return guarded(async () => {
    const page = await listPurchasePoPage(await resolveParty(query));
    const meta = page.meta!;
    const payables = await getSupplierPayables([...page.rows.map((r) => r.supplierCode), ...meta.suppliers.map((s) => s.code ?? "")]);
    return {
      ...page,
      rows: page.rows.map((r) => ({ ...r, payable: payables.get(r.supplierCode) ?? null })),
      meta: { ...meta, suppliers: meta.suppliers.map((s) => ({ ...s, payable: payables.get(s.code ?? "") ?? null })) },
    };
  });
}

export async function loadFacet(key: string, query: PurchaseQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    if (key !== "party" && key !== "contract") return listPurchaseFacet(key, await resolveParty(query));
    // Contracts on the lines under every other filter. The package drops the contract filter for its own facet.
    const contracts = await listPurchaseFacet("contract", withoutParty(query));
    if (key === "contract") {
      const parties = query.filters.party;
      if (!parties?.length) return contracts;
      const allowed = new Set(await contractsOfParties(parties));
      return contracts.filter((c) => allowed.has(c));
    }
    const picked = query.filters.contract;
    const inScope = contracts.filter((c) => c !== BLANK && (!picked?.length || picked.includes(c)));
    if (inScope.length === 0) return [];
    const rows = await prisma.contractReview.findMany({
      where: { contractNo: { in: inScope }, partyNameDump: { not: null } },
      select: { partyNameDump: true },
      distinct: ["partyNameDump"],
      orderBy: { partyNameDump: "asc" },
    });
    return rows.map((r) => r.partyNameDump!).filter((p) => p.trim());
  });
}

export async function loadLines(poNo: string, query: PurchaseQuery): Promise<Result<PoLine[]>> {
  return guarded(async () => listPurchaseLines(poNo, await resolveParty(query)));
}
