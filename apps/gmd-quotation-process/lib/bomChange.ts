/**
 * BomChange workflow: applying an approved change to Bom/BomItem, and proposing
 * CREATE changes for items quoted or ordered without an open BOM. Not a "use
 * server" module: callers check the session.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@gmd/db-quotation";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { NEW_BOM_PREFIX, nextBomIds } from "@/lib/autoBom";
import { actuatorCodesOrEmpty } from "@/lib/verifyBomLookup";
import { BOM_TYPE, classifyBom } from "@/lib/bomClassify";
import { createDraftLines } from "@/lib/actuatorStock";
import { pickNearest } from "@/lib/bomPropose";
import { proposeActuatorBomChanges, actuatorStockCodesFor, loadActuatedDocketItems } from "@/lib/actuatorBom";
import type { BomChangeLine } from "@/lib/bomColumns";

const NO_USE = "NO USE";
const C = "C";

export function parseLines(raw: unknown): BomChangeLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => ({ code: String((l as BomChangeLine)?.code ?? "").trim().toUpperCase(), qty: Number((l as BomChangeLine)?.qty) }))
    .filter((l) => l.code && Number.isFinite(l.qty) && l.qty > 0);
}

/** Lines -> component targets. Throws on a code that is in neither master. */
async function resolveLines(lines: BomChangeLine[]) {
  const codes = lines.map((l) => l.code);
  const [rms, fis] = await Promise.all([
    prisma.rawMaterial.findMany({ where: { erpItemCode: { in: codes } }, select: { id: true, erpItemCode: true } }),
    prisma.fullItem.findMany({ where: { itemCode: { in: codes } }, select: { id: true, itemCode: true } }),
  ]);
  const rmByCode = new Map(rms.map((r) => [r.erpItemCode!.trim().toUpperCase(), r.id]));
  const fiByCode = new Map(fis.map((f) => [f.itemCode!.trim().toUpperCase(), f.id]));
  return lines.map((l) => {
    const rawMaterialId = rmByCode.get(l.code) ?? null;
    const fullItemId = rawMaterialId ? null : (fiByCode.get(l.code) ?? null);
    if (!rawMaterialId && !fullItemId) throw new Error(`Code ${l.code} is not in the raw material or item master`);
    // shortcut: BomItem.quantity is Int, so a fractional qty is rounded; make it Decimal when a BOM needs 0.5 of something.
    return { ...l, rawMaterialId, fullItemId, quantity: Math.max(1, Math.round(l.qty)) };
  });
}

function storedTypeFor(lines: { fullItemId: string | null; code: string }[], skip: ReadonlySet<string>): string | null {
  const t = classifyBom(lines.map((l) => ({ code: l.code, isFullItem: !!l.fullItemId, open: true })), skip);
  if (t === BOM_TYPE.m2m || t === BOM_TYPE.fgSubstitute) return "DIRECT M2M";
  if (t === BOM_TYPE.twoToOne || t === BOM_TYPE.threeToOne) return t;
  if (t === BOM_TYPE.production) return "CREATE BOM";
  return null;
}

/** Applies an APPROVED change. Lines added by hand are manualLink so the hourly sheet sync keeps them. */
export async function applyBomChange(changeId: string, approvedBy: string | null) {
  const change = await prisma.bomChange.findUnique({ where: { id: changeId } });
  if (!change) throw new Error("Change not found");
  if (change.status !== "SUBMITTED") throw new Error(`Only SUBMITTED changes can be approved (this one is ${change.status})`);
  const lines = parseLines(change.lines);

  if (change.kind === "CREATE") {
    if (!lines.length) throw new Error("A CREATE change needs at least one line");
    const fullItem = await prisma.fullItem.findUnique({ where: { itemCode: change.itemCode }, select: { id: true } });
    if (!fullItem) throw new Error(`Item ${change.itemCode} is not in the item master`);
    const resolved = await resolveLines(lines);
    const existing = await prisma.bom.findMany({ where: { bomId: { startsWith: NEW_BOM_PREFIX } }, select: { bomId: true } });
    const [bomId] = nextBomIds(existing.map((b) => b.bomId), 1);
    await prisma.$transaction([
      prisma.bom.create({
        data: {
          bomId,
          fullItemId: fullItem.id,
          bomIdType: storedTypeFor(resolved, await actuatorCodesOrEmpty()),
          components: {
            create: resolved.map((l) => ({ rawMaterialId: l.rawMaterialId, fullItemId: l.fullItemId, quantity: l.quantity, manualLink: true })),
          },
        },
      }),
      prisma.bomChange.update({ where: { id: changeId }, data: { status: "APPROVED", approvedBy, approvedAt: new Date(), bomId } }),
    ]);
    return bomId;
  }

  const bom = await prisma.bom.findUnique({
    where: { bomId: change.bomId ?? "" },
    include: { components: { include: { rawMaterial: { select: { erpItemCode: true } }, fullItem: { select: { itemCode: true } } } } },
  });
  if (!bom) throw new Error(`BOM ${change.bomId} not found`);

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (change.kind === "CLOSE") {
    ops.push(prisma.bomItem.updateMany({ where: { bomId: bom.id }, data: { noUse: NO_USE, cBatch: C } }));
  } else {
    // EDIT / REOPEN: `lines` is the complete wanted list. Lines not wanted are
    // closed (not deleted: supply history may point at them).
    if (!lines.length) throw new Error("An EDIT/REOPEN change needs at least one line");
    const resolved = await resolveLines(lines);
    const wanted = new Map(resolved.map((l) => [l.code, l]));
    for (const c of bom.components) {
      const code = (c.rawMaterial?.erpItemCode ?? c.fullItem?.itemCode ?? "").trim().toUpperCase();
      if (!code) continue;
      const w = wanted.get(code);
      if (w) {
        ops.push(prisma.bomItem.update({ where: { id: c.id }, data: { quantity: w.quantity, noUse: null, cBatch: null, manualLink: true } }));
        wanted.delete(code);
      } else if (!c.noUse) {
        ops.push(prisma.bomItem.update({ where: { id: c.id }, data: { noUse: NO_USE, cBatch: C } }));
      }
    }
    for (const l of wanted.values()) {
      ops.push(prisma.bomItem.create({ data: { bomId: bom.id, rawMaterialId: l.rawMaterialId, fullItemId: l.fullItemId, quantity: l.quantity, manualLink: true } }));
    }
    if (change.kind === "REOPEN") ops.push(prisma.bom.update({ where: { id: bom.id }, data: { reopenedAt: new Date() } }));
  }
  ops.push(prisma.bomChange.update({ where: { id: changeId }, data: { status: "APPROVED", approvedBy, approvedAt: new Date() } }));
  await prisma.$transaction(ops);
  return bom.bomId;
}

/**
 * Proposes CREATE changes for item codes in sent dockets and live contracts
 * that have no open BOM, copying the nearest approved BOM's lines. Never
 * throws: a failure is logged and counted so a sync is not failed by it.
 */
export async function proposeMissingBoms(source: string): Promise<{ proposed: number; failed: number }> {
  const [missing, actuator] = await Promise.all([proposeMissingBomsFor(source), proposeActuatorBomChanges(source)]);
  return { proposed: missing.proposed + actuator.proposed, failed: missing.failed + actuator.failed };
}

async function proposeMissingBomsFor(source: string): Promise<{ proposed: number; failed: number }> {
  try {
    const [contracts, enquiryItems] = await Promise.all([
      tenderPrisma.contractReview.findMany({
        where: { OR: [{ status: null }, { status: "" }] },
        select: { itemCode: true, contractNo: true },
      }),
      prisma.enquiryItem.findMany({
        where: { erpItemCode: { not: null }, enquiry: { emailSentBy: { not: null } } },
        select: { erpItemCode: true, enquiry: { select: { docketNumber: true } } },
      }),
    ]);
    const sourceByCode = new Map<string, string>();
    for (const c of contracts) {
      const code = c.itemCode.trim().toUpperCase();
      if (code && !sourceByCode.has(code)) sourceByCode.set(code, `CONTRACT:${c.contractNo}`);
    }
    for (const e of enquiryItems) {
      const code = (e.erpItemCode ?? "").trim().toUpperCase();
      if (code && !sourceByCode.has(code)) sourceByCode.set(code, `DOCKET:${e.enquiry.docketNumber}`);
    }
    if (sourceByCode.size === 0) return { proposed: 0, failed: 0 };

    const [fullItems, pending] = await Promise.all([
      prisma.fullItem.findMany({
        include: { boms: { include: { components: { include: { rawMaterial: { select: { erpItemCode: true } }, fullItem: { select: { itemCode: true } } } } } } },
      }),
      prisma.bomChange.findMany({ where: { kind: "CREATE", status: { in: ["DRAFT", "SUBMITTED"] } }, select: { itemCode: true } }),
    ]);
    const pendingCodes = new Set(pending.map((p) => p.itemCode.trim().toUpperCase()));

    const openLines = (fi: (typeof fullItems)[number]) => {
      for (const b of fi.boms) {
        const lines = b.components
          .filter((c) => !c.noUse)
          .map((c) => ({ code: (c.rawMaterial?.erpItemCode ?? c.fullItem?.itemCode ?? "").trim(), qty: c.quantity ?? 1 }))
          .filter((l) => l.code);
        if (lines.length) return lines;
      }
      return null;
    };
    const withBom = fullItems
      .map((fi) => ({ ...fi, itemCode: fi.itemCode ?? "", lines: openLines(fi) }))
      .filter((fi) => fi.lines);

    const targets = fullItems.filter((fi) => {
      const code = (fi.itemCode ?? "").trim().toUpperCase();
      return code && sourceByCode.has(code) && !pendingCodes.has(code) && !openLines(fi);
    });

    // Linked ACT / ACT+GB items get the same actuator / gearbox lines as EDIT drafts (see actuatorBom.ts).
    const actuated = targets.length ? await loadActuatedDocketItems().catch(() => []) : [];
    const { byCode, live } = actuated.length ? await actuatorStockCodesFor(actuated, targets) : { byCode: new Map(), live: new Map<string, number>() };
    const skip = byCode.size ? await actuatorCodesOrEmpty() : new Set<string>();

    let proposed = 0;
    for (const t of targets) {
      const nearest = pickNearest({ ...t, itemCode: t.itemCode ?? "" }, withBom);
      const stockCodes = byCode.get((t.itemCode ?? "").trim());
      const lines = stockCodes ? createDraftLines(nearest ? nearest.lines! : [], skip, stockCodes, live) : nearest ? nearest.lines! : [];
      await prisma.bomChange.create({
        data: {
          kind: "CREATE",
          status: "DRAFT",
          itemCode: t.itemCode!.trim(),
          lines: lines as unknown as Prisma.InputJsonArray,
          source: sourceByCode.get(t.itemCode!.trim().toUpperCase()),
          note: nearest ? `Copied from ${nearest.itemCode} (${nearest.boms[0]?.bomId ?? "?"})` : "No matching approved BOM found; fill the lines by hand",
          createdBy: "system",
        },
      });
      proposed++;
    }
    if (proposed) console.log(`[bom-propose] ${source}: proposed ${proposed} BOM(s)`);
    return { proposed, failed: 0 };
  } catch (error) {
    console.error(`[bom-propose] ${source}: ${error instanceof Error ? error.message : error}`);
    return { proposed: 0, failed: 1 };
  }
}
