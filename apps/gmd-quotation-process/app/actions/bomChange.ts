"use server";
import { requireAccess } from "@/lib/access";
import { getCurrentUser, requireAdminOrDeveloper } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { applyBomChange, parseLines, proposeMissingBoms } from "@/lib/bomChange";
import { BOM_CHANGE_KINDS, type BomChangeKind, type BomChangeLine } from "@/lib/bomColumns";

export interface BomChangeView {
  id: string;
  kind: string;
  status: string;
  bomId: string | null;
  itemCode: string;
  lines: BomChangeLine[];
  note: string | null;
  source: string | null;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

const view = (c: {
  id: string; kind: string; status: string; bomId: string | null; itemCode: string; lines: unknown; note: string | null;
  source: string | null; createdBy: string | null; createdAt: Date; submittedAt: Date | null; approvedBy: string | null; approvedAt: Date | null;
}): BomChangeView => ({
  ...c,
  lines: parseLines(c.lines),
  createdAt: c.createdAt.toISOString(),
  submittedAt: c.submittedAt?.toISOString() ?? null,
  approvedAt: c.approvedAt?.toISOString() ?? null,
});

const who = async () => {
  const u = await getCurrentUser();
  return (u?.name || u?.email) ?? null;
};

const fail = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : "Failed" });

export async function listBomChangesAction() {
  await requireAccess();
  try {
    const rows = await prisma.bomChange.findMany({ orderBy: { createdAt: "desc" } });
    const u = await getCurrentUser();
    const role = (u as { role?: string } | null)?.role;
    return { success: true as const, data: rows.map(view), canApprove: role === "admin" || role === "developer" };
  } catch (e) {
    return fail(e);
  }
}

export async function saveBomChangeDraftAction(input: {
  id?: string;
  kind: BomChangeKind;
  bomId?: string | null;
  itemCode: string;
  lines: BomChangeLine[];
  note?: string | null;
  submit?: boolean;
}) {
  await requireAccess();
  try {
    if (!BOM_CHANGE_KINDS.includes(input.kind)) throw new Error("Bad kind");
    const itemCode = String(input.itemCode ?? "").trim();
    if (!itemCode) throw new Error("Item code is required");
    const lines = parseLines(input.lines);
    if (input.kind !== "CLOSE" && !lines.length) throw new Error("At least one line with a code and qty above 0 is needed");
    if (input.kind !== "CREATE" && !String(input.bomId ?? "").trim()) throw new Error("BOM ID is required");
    const data = {
      kind: input.kind,
      bomId: input.kind === "CREATE" ? null : String(input.bomId).trim(),
      itemCode,
      lines,
      note: input.note?.trim() || null,
      status: input.submit ? "SUBMITTED" : "DRAFT",
      submittedAt: input.submit ? new Date() : null,
    };
    const row = input.id
      ? await prisma.bomChange.update({ where: { id: input.id, status: { in: ["DRAFT", "REJECTED"] } }, data })
      : await prisma.bomChange.create({ data: { ...data, source: "MANUAL", createdBy: await who() } });
    return { success: true as const, data: view(row) };
  } catch (e) {
    return fail(e);
  }
}

export async function submitBomChangeAction(id: string) {
  await requireAccess();
  try {
    const row = await prisma.bomChange.update({
      where: { id, status: { in: ["DRAFT", "REJECTED"] } },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    return { success: true as const, data: view(row) };
  } catch (e) {
    return fail(e);
  }
}

export async function approveBomChangeAction(id: string) {
  const session = await requireAdminOrDeveloper();
  try {
    const bomId = await applyBomChange(id, session.user?.name || session.user?.email || null);
    return { success: true as const, bomId };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectBomChangeAction(id: string, note?: string) {
  const session = await requireAdminOrDeveloper();
  try {
    const row = await prisma.bomChange.update({
      where: { id, status: "SUBMITTED" },
      data: { status: "REJECTED", approvedBy: session.user?.name || session.user?.email || null, approvedAt: new Date(), ...(note ? { note } : {}) },
    });
    return { success: true as const, data: view(row) };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBomChangeAction(id: string) {
  await requireAccess();
  try {
    await prisma.bomChange.delete({ where: { id, status: { in: ["DRAFT", "REJECTED"] } } });
    return { success: true as const };
  } catch (e) {
    return fail(e);
  }
}

/** "Mark as correct": one CLOSE change per other open BOM of the item, submitted straight away. */
export async function markCorrectBomAction(itemCode: string, keepBomId: string) {
  await requireAccess();
  try {
    const boms = await prisma.bom.findMany({
      where: { fullItem: { itemCode }, bomId: { not: keepBomId }, components: { some: { noUse: null } } },
      select: { bomId: true },
    });
    const pending = await prisma.bomChange.findMany({
      where: { kind: "CLOSE", status: { in: ["DRAFT", "SUBMITTED"] }, bomId: { in: boms.map((b) => b.bomId) } },
      select: { bomId: true },
    });
    const skip = new Set(pending.map((p) => p.bomId));
    const createdBy = await who();
    const rows = boms.filter((b) => !skip.has(b.bomId));
    if (rows.length) {
      await prisma.bomChange.createMany({
        data: rows.map((b) => ({
          kind: "CLOSE",
          status: "SUBMITTED",
          submittedAt: new Date(),
          bomId: b.bomId,
          itemCode,
          lines: [],
          note: `Closed: ${keepBomId} marked as the correct BOM`,
          source: "MANUAL",
          createdBy,
        })),
      });
    }
    return { success: true as const, created: rows.length };
  } catch (e) {
    return fail(e);
  }
}

export async function proposeMissingBomsAction() {
  await requireAccess();
  return proposeMissingBoms("bom page");
}
