/**
 * ContractReview rows built straight from the GMD EXECUTION TRACKING workbook.
 *
 * Replaces the CONTRACTS + dump tabs of GMD CLIENTS WISE. The rules are the
 * "ERP MAPPING (dump)" tab of that workbook: base table SALE CONTRACT, MC joined
 * on contract no + line no, everything downstream joined on MC no + item code.
 *
 * `ContractReview` is keyed on contract no + item code, while a contract can
 * repeat an item on two lines (SD25Y-00068). Those lines are merged into one row:
 * quantities summed, first line's rate kept.
 * shortcut: one rate per merged row, key the table on line no if rates must stay apart.
 *
 * ITEM_NAME is not built here: the hourly job's item-name step owns it.
 */

import { getAccNameMap } from "@/lib/accMasterLookup";
import { cell, readSheetTabByGid, requireColumns } from "./bomMastErp";
import {
  executionTrackingSpreadsheetId,
  mcRegisterGid,
  prodEntryDumpGid,
  prodOrderDumpGid,
} from "./execution-tracking-columns";

const SALE_CONTRACT_GID = 1660993759;
const INSPECTION_OFFER_DUMP_GID = 148043829;
const SALE_BILL_DEFAULT_GID = 604337671;

/** Every ContractReview field this source writes. */
export const ERP_ROW_FIELDS = [
  "contractNo",
  "itemCode",
  "mcNo",
  "jobCode",
  "partyNameDump",
  "partyItemName",
  "rate",
  "orderQty",
  "mcQty",
  "balanceMc",
  "prodOrdQty",
  "balanceToProdOrd",
  "balanceToProdEnt",
  "diQty",
  "billedQty",
  "balBillAgMc",
  "balBillAgCont",
  "balDiQty",
  "balMcVal",
  "balProdOrdVal",
  "balToProdOrdEntVal",
  "balBillAgMcVal",
  "balBillAgContVal",
  "balDiVal",
  "diVal",
  "icQty",
] as const;

export type ErpContractReviewRow = { contractNo: string; itemCode: string } & Record<
  Exclude<(typeof ERP_ROW_FIELDS)[number], "contractNo" | "itemCode">,
  string | null
>;

export type ErpTab = { tabTitle: string; headers: string[]; rows: string[][] };

export type ErpTabs = {
  saleContract: ErpTab;
  mc: ErpTab;
  prodOrder: ErpTab;
  prodEntry: ErpTab;
  inspectionOffer: ErpTab;
  saleBill: ErpTab;
};

const norm = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();

function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

const add = (m: Map<string, number>, k: string, v: number) =>
  m.set(k, (m.get(k) ?? 0) + v);

function addTo(m: Map<string, Set<string>>, k: string, v: string) {
  if (!v) return;
  const set = m.get(k);
  if (set) set.add(v);
  else m.set(k, new Set([v]));
}

/** Rows keyed `ITEM_CODE||CONTRACT NO` (both normalised), as the sync keys them. */
export function buildContractReviewErpRows(
  tabs: ErpTabs,
  accNames: Map<string, string>,
): Map<string, ErpContractReviewRow> {
  const col = (tab: ErpTab, names: string[]) =>
    requireColumns(tab.headers, names, tab.tabTitle);

  // MC: contract line -> MC qty and the MC numbers raised against it.
  const [mVr, mCon, mSl, mQty, mCan] = col(tabs.mc, [
    "VRNO", "CONTRACT_VRNO", "CONTRACT_SLNO", "QTYORDER", "QTYCANCELLED",
  ]);
  const mcQtyByLine = new Map<string, number>();
  const mcNosByLine = new Map<string, Set<string>>();
  for (const r of tabs.mc.rows) {
    const line = norm(cell(r, mCon)) + "|" + norm(cell(r, mSl));
    add(mcQtyByLine, line, num(cell(r, mQty)) - num(cell(r, mCan)));
    addTo(mcNosByLine, line, norm(cell(r, mVr)));
  }

  // Everything below is keyed `MC no|item code`.
  const [oMc, oVr, oItem, oQty] = col(tabs.prodOrder, [
    "CONTRACT_VRNO", "VRNO", "ITEM_CODE", "NET_QTYORDER",
  ]);
  const prodOrdQty = new Map<string, number>();
  const prodOrdNos = new Map<string, Set<string>>();
  for (const r of tabs.prodOrder.rows) {
    const k = norm(cell(r, oMc)) + "|" + norm(cell(r, oItem));
    add(prodOrdQty, k, num(cell(r, oQty)));
    addTo(prodOrdNos, k, norm(cell(r, oVr)));
  }

  // PROD ENTRY links on production order no + item code.
  const [eOrd, eItem, eQty] = col(tabs.prodEntry, ["ORDER_VRNO", "ITEM_CODE", "QTYRECD"]);
  const prodEntQty = new Map<string, number>();
  for (const r of tabs.prodEntry.rows) {
    add(prodEntQty, norm(cell(r, eOrd)) + "|" + norm(cell(r, eItem)), num(cell(r, eQty)));
  }

  const [iMc, iItem, iDi, iDiCan, iIc] = col(tabs.inspectionOffer, [
    "CONTRACT_VRNO", "ITEM_CODE", "DI_QTY", "DI_QTYCANCELLED", "IC_QTY",
  ]);
  const diQty = new Map<string, number>();
  const icQty = new Map<string, number>();
  for (const r of tabs.inspectionOffer.rows) {
    const k = norm(cell(r, iMc)) + "|" + norm(cell(r, iItem));
    add(diQty, k, num(cell(r, iDi)) - num(cell(r, iDiCan)));
    add(icQty, k, num(cell(r, iIc)));
  }

  const [bMc, bItem, bQty] = col(tabs.saleBill, ["ORDER_VRNO", "ITEM_CODE", "QTYISSUED"]);
  const billedQty = new Map<string, number>();
  for (const r of tabs.saleBill.rows) {
    add(billedQty, norm(cell(r, bMc)) + "|" + norm(cell(r, bItem)), num(cell(r, bQty)));
  }

  // SALE CONTRACT lines, merged per contract no + item code.
  const [sVr, sAcc, sItem, sName, sRate, sQty, sCan, sSl, sMc] = col(tabs.saleContract, [
    "VRNO", "ACC_CODE", "ITEM_CODE", "PARTY_ITEM_NAME", "RATE",
    "QTYORDER", "QTYCANCELLED", "SLNO", "MC NO",
  ]);
  type Group = {
    contractNo: string;
    itemCode: string;
    accCode: string;
    partyItemName: string;
    rate: string;
    mcNo: string;
    orderQty: number;
    lines: string[];
  };
  const groups = new Map<string, Group>();
  for (const r of tabs.saleContract.rows) {
    const contractNo = cell(r, sVr);
    const itemCode = cell(r, sItem);
    // Row 2 of the tab repeats the header.
    if (!contractNo || !itemCode || norm(contractNo) === "VRNO") continue;
    const key = norm(itemCode) + "||" + norm(contractNo);
    let g = groups.get(key);
    if (!g) {
      g = {
        contractNo, itemCode,
        accCode: cell(r, sAcc), partyItemName: "", rate: cell(r, sRate), mcNo: "",
        orderQty: 0, lines: [],
      };
      groups.set(key, g);
    }
    g.partyItemName ||= cell(r, sName);
    g.mcNo ||= cell(r, sMc);
    g.orderQty += num(cell(r, sQty)) - num(cell(r, sCan));
    g.lines.push(norm(contractNo) + "|" + norm(cell(r, sSl)));
  }

  const out = new Map<string, ErpContractReviewRow>();
  for (const [key, g] of groups) {
    const item = norm(g.itemCode);
    const mcNos = new Set<string>(g.mcNo ? [norm(g.mcNo)] : []);
    let mc = 0;
    for (const line of g.lines) {
      mc += mcQtyByLine.get(line) ?? 0;
      for (const no of mcNosByLine.get(line) ?? []) mcNos.add(no);
    }
    let prodOrd = 0, prodEnt = 0, di = 0, ic = 0, billed = 0;
    for (const no of mcNos) {
      const k = no + "|" + item;
      prodOrd += prodOrdQty.get(k) ?? 0;
      for (const po of prodOrdNos.get(k) ?? []) prodEnt += prodEntQty.get(po + "|" + item) ?? 0;
      di += diQty.get(k) ?? 0;
      ic += icQty.get(k) ?? 0;
      billed += billedQty.get(k) ?? 0;
    }

    const rate = num(g.rate);
    const balanceMc = g.orderQty - mc;
    const balProdOrd = mc - prodOrd;
    const balProdEnt = prodOrd - prodEnt;
    const balBillMc = mc - billed;
    const balBillCont = g.orderQty - billed;
    const balDi = mc - di;

    out.set(key, {
      contractNo: g.contractNo,
      itemCode: g.itemCode,
      mcNo: g.mcNo || null,
      jobCode: g.mcNo || null,
      partyNameDump: accNames.get(norm(g.accCode)) ?? null,
      partyItemName: g.partyItemName || null,
      rate: g.rate || null,
      orderQty: fmt(g.orderQty),
      mcQty: fmt(mc),
      balanceMc: fmt(balanceMc),
      prodOrdQty: fmt(prodOrd),
      balanceToProdOrd: fmt(balProdOrd),
      balanceToProdEnt: fmt(balProdEnt),
      diQty: fmt(di),
      billedQty: fmt(billed),
      balBillAgMc: fmt(balBillMc),
      balBillAgCont: fmt(balBillCont),
      balDiQty: fmt(balDi),
      balMcVal: fmt(balanceMc * rate),
      balProdOrdVal: fmt(balProdOrd * rate),
      balToProdOrdEntVal: fmt(balProdEnt * rate),
      balBillAgMcVal: fmt(balBillMc * rate),
      balBillAgContVal: fmt(balBillCont * rate),
      balDiVal: fmt(balDi * rate),
      diVal: fmt(di * rate),
      icQty: fmt(ic),
    });
  }
  return out;
}

/** Reads the six ERP tabs and the local party-name list, then builds the rows. */
export async function loadContractReviewErpRows(): Promise<Map<string, ErpContractReviewRow>> {
  const id = executionTrackingSpreadsheetId();
  const [saleContract, mc, prodOrder, prodEntry, inspectionOffer, saleBill, accNames] =
    await Promise.all([
      readSheetTabByGid(id, SALE_CONTRACT_GID),
      readSheetTabByGid(id, mcRegisterGid()),
      readSheetTabByGid(id, prodOrderDumpGid()),
      readSheetTabByGid(id, prodEntryDumpGid()),
      readSheetTabByGid(id, INSPECTION_OFFER_DUMP_GID),
      readSheetTabByGid(id, Number(process.env.SALE_BILL_GID) || SALE_BILL_DEFAULT_GID),
      getAccNameMap(),
    ]);
  return buildContractReviewErpRows(
    { saleContract, mc, prodOrder, prodEntry, inspectionOffer, saleBill },
    accNames,
  );
}
