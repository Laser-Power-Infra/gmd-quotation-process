import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import { recalculateItem, serializeItem } from "@/lib/costCalculator";
import { isEnquiryFrozen } from "@/lib/oneClickAccess";
import { bareValveOf, deriveMapKey, hasActuatorLink, isActuatorCandidate, planActuator, SPECIAL_OEM } from "@/lib/actuatorCost";

/** DB side of the actuator link: fills codes from MAPPING, prices them from the masters, writes productCost. */

export interface ActuatorPatch {
  actuatorMake?: string | null;
  actCode?: string | null;
  gbCode?: string | null;
  controlType?: string | null;
  adaptorCost?: number | null;
  assemblyCost?: number | null;
}

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

/** Returns the refreshed item, or a reason it was skipped. */
export async function applyActuatorToItem(itemId: string, patch: ActuatorPatch & { rederive?: boolean } = {}) {
  const it = await prisma.enquiryItem.findUnique({ where: { id: itemId }, include: { enquiry: { select: { apm: true, offerPdfGeneratedAt: true } } } });
  if (!it) return { skipped: "Item not found." };
  if (isEnquiryFrozen(it.enquiry.apm, it.enquiry.offerPdfGeneratedAt)) return { skipped: "Frozen after one-time PDF." };
  if (!isActuatorCandidate(it)) return { skipped: "Op Type is not ACT / ACT+GB / ELECTRIC." };

  const key = deriveMapKey(it);
  const mapping = key ? await prisma.actuatorMapping.findUnique({ where: { mapKey: key } }) : null;
  const gearboxes = mapping ? await prisma.gearboxMaster.findMany() : [];
  const adaptorCost = patch.adaptorCost !== undefined ? patch.adaptorCost : num(it.adaptorCost);
  const assemblyCost = patch.assemblyCost !== undefined ? patch.assemblyCost : num(it.assemblyCost);
  const controlType = patch.controlType !== undefined ? patch.controlType : it.controlType;

  const base = {
    ...it, productCost: num(it.productCost), bareValveCost: num(it.bareValveCost),
    lastTotal: (it.actuatorBreakdown as { total?: number | null } | null)?.total ?? null, adaptorCost, assemblyCost,
  };
  // Prices are looked up for the codes the plan settles on, so plan twice: codes first, then priced.
  const codes = planActuator(base, patch, mapping, gearboxes, { act: null, gb: null });
  const [act, gb] = await Promise.all([
    codes.actCode ? prisma.actuatorMaster.findUnique({ where: { actCode: codes.actCode } }) : null,
    codes.gbCode ? prisma.gearboxMaster.findUnique({ where: { gbCode: codes.gbCode } }) : null,
  ]);
  const plan = planActuator(base, patch, mapping, gearboxes, {
    act: act ? { price: act.price, validTill: act.offerValidTill } : null,
    gb: gb ? { price: gb.price } : null,
  });
  const res = plan.cost;

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: {
      actuatorMake: plan.make, actCode: plan.actCode, gbCode: plan.gbCode, controlType,
      adaptorCost, assemblyCost, bareValveCost: plan.bare,
      // Keep the last stock read (Sync Available Stock); the chip ignores it once the codes differ.
      actuatorBreakdown: { ...res, stock: (it.actuatorBreakdown as { stock?: unknown } | null)?.stock } as unknown as Prisma.InputJsonObject,
      // Pending / Special: no total, so no lower number is ever shown as the cost.
      ...(res.total == null ? { productCost: null, cost: null } : {}),
    },
  });
  if (res.total != null) await recalculateItem(itemId, { productCost: res.total }, { actuatorTotal: true });
  const fresh = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
  return { item: serializeItem(fresh), pending: res.pending.length > 0, special: res.pending.includes(SPECIAL_OEM), reason: plan.reason };
}

/**
 * Re-price every linked actuated item after the masters changed (new prices, new mapping), so nobody has to press
 * Fetch Actuator. Only linked items: a legacy ACT row with no link keeps its cost. Frozen dockets are skipped.
 */
export async function repriceLinkedActuatorItems() {
  const rows = await prisma.enquiryItem.findMany({
    where: { OR: [{ actCode: { not: null } }, { gbCode: { not: null } }, { actuatorBreakdown: { not: Prisma.DbNull } }] },
    select: { id: true, operationType: true, itemType: true },
  });
  const out = { priced: 0, pending: 0, skipped: 0, failed: 0 };
  for (const row of rows.filter(isActuatorCandidate)) {
    try {
      const r = await applyActuatorToItem(row.id);
      if (!r.item) out.skipped++; else if (r.pending) out.pending++; else out.priced++;
    } catch (e) {
      out.failed++;
      console.warn(`[repriceLinkedActuatorItems] ${row.id}:`, e);
    }
  }
  return out;
}

type Specs = { operationType?: string | null; itemType?: string | null; size?: string | null; pnRating?: string | null; itemName?: string | null };

/**
 * After Op Type / Item type / DN / PN change (or a dialog save): link a new candidate (auto-fill), re-price a linked one
 * (codes re-derived when the MAP KEY changed, hand codes kept otherwise), or de-actuate one that stopped being a candidate
 * (bare valve cost restored, breakdown and codes cleared). Always built from bareValveCost, never from a total.
 */
export async function syncActuatorOnChange(itemId: string, before: Specs) {
  const it = await prisma.enquiryItem.findUnique({ where: { id: itemId }, include: { enquiry: { select: { apm: true, offerPdfGeneratedAt: true } } } });
  if (!it || isEnquiryFrozen(it.enquiry.apm, it.enquiry.offerPdfGeneratedAt)) return null;
  const linked = hasActuatorLink(it);
  if (isActuatorCandidate(it)) {
    // A legacy candidate with no link keeps its cost until Fetch Actuator; only a newly-becoming candidate is auto-linked.
    if (!linked && isActuatorCandidate(before)) return null;
    return applyActuatorToItem(itemId, linked && deriveMapKey(before) !== deriveMapKey(it) ? { rederive: true } : {});
  }
  if (!linked) return null;
  const restored = bareValveOf({ productCost: num(it.productCost), bareValveCost: num(it.bareValveCost), lastTotal: (it.actuatorBreakdown as { total?: number | null } | null)?.total ?? null });
  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: { actCode: null, gbCode: null, bareValveCost: null, actuatorBreakdown: Prisma.DbNull, productCost: restored, ...(restored == null ? { cost: null } : {}) },
  });
  if (restored != null) await recalculateItem(itemId, { productCost: restored });
  return { deactuated: true };
}
