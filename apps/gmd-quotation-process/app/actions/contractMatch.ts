"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { isLiveStatus } from "@/lib/indentListingLiveFilter";
import {
  codeKey,
  contractQtyByCode,
  contractRateByCode,
  docketQtyByCode,
  equalQtyCodes,
  findCodeMismatches,
  groupLinesByContract,
  mergeContractNos,
  normalizeContractKey,
  normalizeParty,
  parseNum,
  rankDocketsForContracts,
  type CodeMismatch,
} from "@/lib/contractDocketMatch";
import { recalculateItem } from "@/lib/costCalculator";
import { logItemChanges } from "@/lib/itemChangeLog";
import { updateEnquiryFieldAction } from "@/app/actions/enquiry";
import { syncContractReviewEnquiryFieldsBatchAction } from "@/app/actions/contractReview";

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

const LINE_SELECT = { id: true, contractNo: true, itemCode: true, size: true, orderQty: true, rate: true, partyNameDump: true } as const;

async function contractLines(contractNos: string[]) {
  const keys = [...new Set(contractNos.map((c) => c.trim()).filter(Boolean))];
  if (keys.length === 0) return [];
  return tenderPrisma.contractReview.findMany({
    where: { contractNo: { in: keys, mode: "insensitive" } },
    select: LINE_SELECT,
  });
}

/** Contract no -> docket numbers whose Selected Contract No carries it. */
async function linkedDocketsByContract() {
  const linked = await prisma.enquiry.findMany({
    where: { selectedContractNo: { isEmpty: false } },
    select: { docketNumber: true, selectedContractNo: true },
  });
  const out = new Map<string, string[]>();
  for (const e of linked) {
    for (const cn of e.selectedContractNo) {
      const k = normalizeContractKey(cn);
      out.set(k, [...(out.get(k) ?? []), e.docketNumber]);
    }
  }
  return out;
}

export type LiveContractRow = {
  contractNo: string;
  party: string;
  dateOfContract: string | null;
  lines: number;
  dockets: string[];
};

/** Live contracts (at least one line with blank STATUS) and the dockets linked to each. */
export async function listLiveContractsAction(): Promise<
  { success: true; data: LiveContractRow[] } | { success: false; error: string }
> {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const rows = await tenderPrisma.contractReview.findMany({
      select: { contractNo: true, partyNameDump: true, dateOfContract: true, status: true },
    });
    const byContract = new Map<string, LiveContractRow & { live: boolean }>();
    for (const r of rows) {
      const k = normalizeContractKey(r.contractNo);
      if (!k) continue;
      const cur = byContract.get(k) ?? {
        contractNo: r.contractNo.trim(),
        party: r.partyNameDump ?? "",
        dateOfContract: r.dateOfContract ?? null,
        lines: 0,
        dockets: [],
        live: false,
      };
      cur.lines++;
      cur.live ||= isLiveStatus(r.status);
      if (!cur.party && r.partyNameDump) cur.party = r.partyNameDump;
      byContract.set(k, cur);
    }
    const linked = await linkedDocketsByContract();
    const data = [...byContract.entries()]
      .filter(([, c]) => c.live)
      .map(([k, c]) => ({ contractNo: c.contractNo, party: c.party, dateOfContract: c.dateOfContract, lines: c.lines, dockets: linked.get(k) ?? [] }))
      .sort((a, b) => b.contractNo.localeCompare(a.contractNo));
    return { success: true, data };
  } catch (error) {
    console.error("[contract-match] list failed:", error);
    return { success: false, error: errorMessage(error, "Failed to load contracts.") };
  }
}

/** Top 3 dockets of the contracts' party, ranked by codes with equal total qty. */
export async function suggestDocketsForContractsAction(contractNos: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const picked = await contractLines(contractNos);
    if (picked.length === 0) return { success: false as const, error: "No Contract Review lines for the picked contract(s)." };
    const parties = new Set(picked.map((l) => normalizeParty(l.partyNameDump)).filter(Boolean));
    if (parties.size === 0) return { success: false as const, error: "The picked contract(s) have no party name." };

    const heads = await prisma.enquiry.findMany({ select: { id: true, partyName: true } });
    const ids = heads.filter((h) => parties.has(normalizeParty(h.partyName))).map((h) => h.id);
    const dockets = await prisma.enquiry.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, docketNumber: true, partyName: true, enquiryDate: true, selectedContractNo: true,
        items: { select: { id: true, erpItemCode: true, size: true, quantity: true } },
      },
    });
    const allContractNos = [...contractNos, ...dockets.flatMap((d) => d.selectedContractNo)];
    const lines = groupLinesByContract(await contractLines(allContractNos));
    return { success: true as const, data: rankDocketsForContracts(contractNos, dockets, lines) };
  } catch (error) {
    console.error("[contract-match] suggest failed:", error);
    return { success: false as const, error: errorMessage(error, "Failed to suggest dockets.") };
  }
}

export type MatchedItemResult = {
  itemId: string;
  itemName: string;
  code: string;
  oldRate: string | null;
  contractRate: number;
  vaPercent: number | null;
  negativeVa: boolean;
  error?: string;
};

/**
 * Confirm a match: add the contract(s) to the docket's Selected Contract No, set
 * quoted rate = contract rate on every code whose total qty matches (VA% is
 * re-derived by the normal quoted-rate edit path), and push State / Utility
 * into the contracts' Contract Review rows.
 */
export async function applyContractDocketMatchAction(enquiryId: string, contractNos: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: {
        docketNumber: true, selectedContractNo: true,
        items: { select: { id: true, itemName: true, erpItemCode: true, quantity: true, quotedRate: true, vaPercent: true, contractReviewRate: true } },
      },
    });
    if (!enquiry) return { success: false as const, error: "Docket not found." };

    const merged = mergeContractNos(enquiry.selectedContractNo, contractNos);
    const lines = await contractLines(merged);
    const matched = new Set(equalQtyCodes(contractQtyByCode(lines), docketQtyByCode(enquiry.items)));
    const rates = contractRateByCode(lines.filter((l) => matched.has(codeKey(l.itemCode))));

    const linkRes = await updateEnquiryFieldAction(enquiryId, "selectedContractNo", merged);
    if (!linkRes.success) return { success: false as const, error: linkRes.error || "Failed to link contract(s)." };

    const items: MatchedItemResult[] = [];
    for (const it of enquiry.items) {
      const code = codeKey(it.erpItemCode);
      const rate = rates.get(code);
      if (rate === undefined) continue;
      const base = { itemId: it.id, itemName: it.itemName, code, oldRate: it.quotedRate, contractRate: rate };
      try {
        // Contract rate is final: bypasses the validation / APM-frozen guards of updateItemFieldAction.
        await prisma.enquiryItem.update({ where: { id: it.id }, data: { contractReviewRate: String(rate) } });
        const after = await recalculateItem(it.id, { quotedRate: rate }, { exactQuotedRate: true });
        const va = after?.vaPercent == null ? null : parseNum(after.vaPercent);
        await logItemChanges(
          [
            { field: "contractReviewRate", oldValue: it.contractReviewRate, newValue: String(rate) },
            { field: "quotedRate", oldValue: it.quotedRate, newValue: after?.quotedRate },
            { field: "vaPercent", oldValue: it.vaPercent, newValue: after?.vaPercent },
          ].map((c) => ({ ...c, itemId: it.id, enquiryId })),
        );
        items.push({ ...base, vaPercent: va, negativeVa: va !== null && va < 0 });
      } catch (e) {
        items.push({ ...base, vaPercent: null, negativeVa: false, error: errorMessage(e, "Not updated.") });
      }
    }

    // Same push the Contract Review "sync enquiry fields" button does, for these contracts only.
    const crSync = await syncContractReviewEnquiryFieldsBatchAction(lines.map((l) => l.id));
    if (!crSync.success) console.warn("[contract-match] Contract Review State/Utility sync skipped:", "error" in crSync ? crSync.error : "");

    const updated = items.filter((i) => !i.error).length;
    const negativeVaCount = items.filter((i) => i.negativeVa).length;
    return {
      success: true as const,
      data: { docketNumber: enquiry.docketNumber, selectedContractNo: merged, matchedCodes: matched.size, items, updated, negativeVaCount },
    };
  } catch (error) {
    console.error("[contract-match] apply failed:", error);
    return { success: false as const, error: errorMessage(error, "Failed to apply the match.") };
  }
}

export type DocketCodeMismatch = CodeMismatch & { enquiryId: string; docketNumber: string; contractNos: string[] };

/** Item-code check over every docket linked to a contract. */
export async function checkDocketCodeMismatchesAction() {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const dockets = await prisma.enquiry.findMany({
      where: { selectedContractNo: { isEmpty: false } },
      select: {
        id: true, docketNumber: true, selectedContractNo: true,
        items: { select: { id: true, itemName: true, erpItemCode: true, size: true, quantity: true }, orderBy: { position: "asc" } },
      },
      orderBy: { docketNumber: "asc" },
    });
    const lines = groupLinesByContract(await contractLines(dockets.flatMap((d) => d.selectedContractNo)));
    const data: DocketCodeMismatch[] = dockets.flatMap((d) => {
      const own = [...new Set(d.selectedContractNo.map(normalizeContractKey))].flatMap((k) => lines.get(k) ?? []);
      return findCodeMismatches(d.items, own).map((m) => ({
        ...m, enquiryId: d.id, docketNumber: d.docketNumber, contractNos: d.selectedContractNo,
      }));
    });
    return { success: true as const, data };
  } catch (error) {
    console.error("[contract-match] code check failed:", error);
    return { success: false as const, error: errorMessage(error, "Failed to check item codes.") };
  }
}
