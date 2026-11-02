"use server";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { normaliseFollowUp } from "@/lib/ledgerFollowUp";
import type { LedgerFollowUpInput } from "@/lib/ledgerFollowUp";

/** Upserts one follow-up row (party-level when vrNo is blank). Last write wins; every save also appends a history snapshot. */
export async function saveLedgerFollowUpAction(input: LedgerFollowUpInput): Promise<{ success: boolean; error?: string }> {
  await requireAccess();
  const r = normaliseFollowUp(input);
  if ("error" in r) return { success: false, error: r.error };
  try {
    let updatedById: string | null = null;
    try {
      const { auth } = await import("@/auth");
      updatedById = (await auth())?.user?.id ?? null;
    } catch {
      // open local deployment may have no session; the edit is still valid
    }
    const { ledger, accCode, vrNo, ...rest } = r.data;
    const { owner, lastFollowUp, promisedDate, promisedAmount, nextActionDate, status, remarks } = rest;
    await prisma.$transaction([
      prisma.ledgerFollowUp.upsert({
        where: { ledger_accCode_vrNo: { ledger, accCode, vrNo } },
        create: { ledger, accCode, vrNo, ...rest, updatedById },
        update: { ...rest, updatedById },
      }),
      prisma.ledgerFollowUpLog.create({
        data: { ledger, accCode, vrNo, owner, lastFollowUp, promisedDate, promisedAmount, nextActionDate, status, remarks, changedById: updatedById },
      }),
    ]);
    return { success: true };
  } catch (e) {
    console.error("saveLedgerFollowUpAction", e);
    return { success: false, error: "Could not save the follow-up." };
  }
}

export type FollowUpHistoryRow = {
  changedAt: string;
  vrNo: string;
  owner: string | null;
  lastFollowUp: string | null;
  promisedDate: string | null;
  promisedAmount: string | null;
  nextActionDate: string | null;
  status: string | null;
  remarks: string | null;
};

/** Newest first. Loaded when a party is opened in the drill-down, so the page payload stays small. */
export async function getLedgerFollowUpHistoryAction(ledger: string, accCode: string): Promise<FollowUpHistoryRow[]> {
  await requireAccess();
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  const rows = await prisma.ledgerFollowUpLog.findMany({ where: { ledger, accCode }, orderBy: { changedAt: "desc" }, take: 200 });
  return rows.map((r) => ({
    changedAt: r.changedAt.toISOString(),
    vrNo: r.vrNo,
    owner: r.owner,
    lastFollowUp: day(r.lastFollowUp),
    promisedDate: day(r.promisedDate),
    promisedAmount: r.promisedAmount?.toString() ?? null,
    nextActionDate: day(r.nextActionDate),
    status: r.status,
    remarks: r.remarks,
  }));
}
