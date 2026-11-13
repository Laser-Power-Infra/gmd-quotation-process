import "server-only";

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prodEntryQty } from "@gmd/contract-review/columns";
import { prisma } from "@/lib/prisma";
import { getFiscalYearLabel } from "@/lib/docketNumber";
import { fiscalYearVariants, normalizeKey } from "@/lib/gmd_lib/execution-tracking-columns";
import { resolveItemTypes } from "@/lib/erpItemNameLookup";
import { costLines, supplyCostInput } from "@/lib/lineCost-server";
import { minVaPercent } from "@/lib/vaRules";
import { monthKey, num, saleMoney, valveTypeOf, type ContractLine, type SaleLine } from "@/lib/executionPages";

const text = (v: string | null | undefined) => (v ?? "").trim();

/** Every ContractReview line (order -> MC -> prod order -> offer -> inspection -> DI -> bill), with the latest sync time. */
export async function getContractLines(): Promise<{ lines: ContractLine[]; syncedAt: string | null }> {
  const rows = await tenderPrisma.contractReview.findMany({
    select: {
      contractNo: true, itemCode: true, itemName: true, partyItemName: true, partyNameDump: true,
      erpPartyNameFromGmdSupplyHistory: true, dateOfContract: true, rate: true, orderQty: true, mcQty: true,
      prodOrdQty: true, balanceToProdEnt: true, prodEntryDate: true, diQty: true, billedQty: true,
      productionOrderNumber: true, offerNumber: true, inspectionNumber: true, diDate: true, syncedAt: true,
    },
  });
  const latest = rows.reduce<Date | null>((a, r) => (!a || r.syncedAt > a ? r.syncedAt : a), null);
  const lines = rows.map((r) => {
    return {
      contractNo: r.contractNo,
      party: text(r.partyNameDump) || text(r.erpPartyNameFromGmdSupplyHistory) || "-",
      itemCode: r.itemCode,
      itemName: text(r.itemName) || text(r.partyItemName),
      dateOfContract: r.dateOfContract,
      rate: num(r.rate),
      orderQty: num(r.orderQty),
      mcQty: num(r.mcQty),
      prodOrdQty: num(r.prodOrdQty),
      prodEntryQty: prodEntryQty(r.prodOrdQty, r.balanceToProdEnt),
      prodEntryDate: r.prodEntryDate,
      diQty: num(r.diQty),
      billedQty: num(r.billedQty),
      productionOrderNumber: r.productionOrderNumber,
      offerNumber: r.offerNumber,
      inspectionNumber: r.inspectionNumber,
      diDate: r.diDate,
    };
  });
  return { lines, syncedAt: latest?.toISOString() ?? null };
}

export type InvoiceLine = {
  invoiceNo: string; date: string | null; itemName: string; itemCode: string | null;
  qty: string | null; value: string | null; lrNoDt: string | null;
  orderCopy: string | null; invoice: string | null; inspectionReport: string | null;
};

/** Invoices raised against one contract: the last step of the paper trail. */
export async function getContractInvoices(contractNo: string): Promise<InvoiceLine[]> {
  const rows = await prisma.supplyHistoryItem.findMany({
    where: { erpContractNo: { equals: contractNo.trim(), mode: "insensitive" } },
    select: { invoiceNo: true, date: true, itemName: true, erpItemCode: true, quantity: true, value: true, lrNoDt: true, orderCopy: true, invoice: true, inspectionReport: true },
    orderBy: { invoiceNo: "asc" },
  });
  return rows.map((r) => ({ ...r, itemCode: r.erpItemCode, qty: r.quantity }));
}

/** One fiscal year of invoice lines for the Sales Register, each with its cost for the gross profit view. */
export async function getSalesLines(fy?: string): Promise<{ fy: string; years: string[]; lines: SaleLine[]; syncedAt: string | null }> {
  const year = fy && /^\d{4}-\d{2}$/.test(fy) ? fy : getFiscalYearLabel(new Date());
  const [rows, yearRows, run] = await Promise.all([
    prisma.supplyHistoryItem.findMany({
      where: { financialYear: { in: fiscalYearVariants(year) } },
      select: { invoiceNo: true, date: true, consigneeName: true, erpPartyName: true, partyName: true, typeOfValve: true, derivedItemType: true, sizeOfValve: true, derivedSize: true, classOfValve: true, quantity: true, value: true, erpItemCode: true, erpContractNo: true, itemName: true },
    }),
    prisma.supplyHistoryItem.findMany({ distinct: ["financialYear"], select: { financialYear: true } }),
    prisma.engineeringSync.findUnique({ where: { tabKey: "execution-tracking" }, select: { syncedAt: true } }),
  ]);
  const [types, costs] = await Promise.all([
    resolveItemTypes(rows.map((r) => text(r.erpItemCode))),
    costLines(rows.map(supplyCostInput)),
  ]);
  const years = [...new Set(yearRows.map((r) => text(r.financialYear)).filter((y) => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
  return {
    fy: year,
    years: years.includes(year) ? years : [year, ...years],
    syncedAt: run?.syncedAt.toISOString() ?? null,
    lines: rows.map((r, i) => {
      const valveType = valveTypeOf(types.get(normalizeKey(r.erpItemCode)), text(r.typeOfValve) || text(r.derivedItemType));
      const size = text(r.sizeOfValve) || text(r.derivedSize) || "-";
      return {
        invoiceNo: r.invoiceNo,
        month: monthKey(r.date),
        party: text(r.erpPartyName) || text(r.consigneeName) || text(r.partyName) || "-",
        valveType,
        size,
        pressureClass: text(r.classOfValve) || "-",
        ...saleMoney(r.quantity, r.value, costs[i].unitCost, costs[i].quotedUnitCost),
        minVa: minVaPercent({ itemType: valveType, size, itemName: r.itemName }),
      };
    }),
  };
}
