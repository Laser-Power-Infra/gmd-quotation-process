import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import { recalculateItem, serializeItem } from "@/lib/costCalculator";
import { isEnquiryFrozen } from "@/lib/oneClickAccess";
import { bareValveOf, deriveMapKey, hasActuatorLink, isActuatorCandidate, planActuator } from "@/lib/actuatorCost";
import { handPicks, rmLookupCodes, selectActuator } from "@/lib/actuatorSelect";
import { loadActuatorMaster } from "@/lib/actuatorSheet";
import { stockSummary } from "@/lib/actuatorStock";
import { freeQty } from "@/lib/actuatorStockSync";
import { buildRawMaterialsCostMap } from "@/lib/gmd2to1CostLookup";
import { ACT_VA } from "@/lib/vaRules";

/** DB side of the actuator link: picks actuator + gearbox from the live master sheet and stock, prices them, writes productCost. */

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
// manualTotal (only the two hand-edit paths pass it; not part of the client-facing patch): a number sets the typed whole price,
// null removes it, undefined keeps what the breakdown holds. It only takes effect on an ACTUATOR line or a refer-OEM line.
export async function applyActuatorToItem(itemId: string, patch: ActuatorPatch = {}, manualTotal?: number | null) {
  const it = await prisma.enquiryItem.findUnique({ where: { id: itemId }, include: { enquiry: { select: { apm: true, offerPdfGeneratedAt: true } } } });
  if (!it) return { skipped: "Item not found." };
  if (isEnquiryFrozen(it.enquiry.apm, it.enquiry.offerPdfGeneratedAt)) return { skipped: "Frozen after one-time PDF." };
  if (!isActuatorCandidate(it)) return { skipped: "Op Type is not ACT / ACT+GB / ELECTRIC." };

  const master = await loadActuatorMaster();
  // Typed by hand: these win (adaptor / assembly over the estimates, codes over the pick).
  const adaptorCost = patch.adaptorCost !== undefined ? patch.adaptorCost : num(it.adaptorCost);
  const assemblyCost = patch.assemblyCost !== undefined ? patch.assemblyCost : num(it.assemblyCost);
  const controlType = patch.controlType !== undefined ? patch.controlType : it.controlType;
  const hand = handPicks(it, patch, master);

  // Every stock / Viral ERP code, plus a code typed by hand (a Raw Material code, e.g. RCB040006, is priced from the RM master).
  const codes = rmLookupCodes(master, [hand.actCode, hand.gbCode]);
  const [free, rm] = await Promise.all([freeQty(codes), buildRawMaterialsCostMap(codes)]);
  const qty = Number(it.quantity);
  const pick = selectActuator({
    mapKey: deriveMapKey(it), actuatorItem: (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR",
    qty, text: it.itemName, ...hand, adaptor: adaptorCost, assembly: assemblyCost,
  }, master, free, rm);
  const plan = planActuator({
    itemType: it.itemType, productCost: num(it.productCost), bareValveCost: num(it.bareValveCost),
    lastTotal: (it.actuatorBreakdown as { total?: number | null } | null)?.total ?? null,
  }, pick, hand, manualTotal !== undefined ? manualTotal : (it.actuatorBreakdown as { manualTotal?: number } | null)?.manualTotal);
  const res = plan.cost;
  const s = pick.selection;
  const stock = stockSummary(plan, { act: s.act?.erpCode ? [s.act.erpCode] : [], gb: s.gb?.erpCode ?? null }, free, qty);

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: {
      actuatorMake: plan.make, actCode: plan.actCode, gbCode: plan.gbCode, controlType,
      adaptorCost, assemblyCost, bareValveCost: plan.bare,
      actuatorBreakdown: { ...res, selection: s, stock } as unknown as Prisma.InputJsonObject,
      // Pending / OEM RFQ: no total, so no lower number is ever shown as the cost.
      ...(res.total == null ? { productCost: null, cost: null } : {}),
    },
  });
  // Item type ACTUATOR is priced at cost x 1.05 (Puja, 18 Nov): Fetch resets an old VA% unless the rate is validated.
  const actuatorVa = (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR" && it.validation !== "Yes" ? { vaPercent: ACT_VA } : {};
  if (res.total != null) await recalculateItem(itemId, { productCost: res.total, ...actuatorVa }, { actuatorTotal: true });
  const fresh = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
  return { item: serializeItem(fresh), pending: res.pending.length > 0, special: s.status === "OEM RFQ", reason: pick.missing.join("; ") || null };
}

/**
 * Re-price every linked actuated item (e.g. after the master sheet or stock changed), so nobody has to press
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
 * (hand codes dropped when the MAP KEY changed, kept otherwise), or de-actuate one that stopped being a candidate
 * (bare valve cost restored, breakdown and codes cleared). Always built from bareValveCost, never from a total.
 */
export async function syncActuatorOnChange(itemId: string, before: Specs, manualTotal?: number | null) {
  const it = await prisma.enquiryItem.findUnique({ where: { id: itemId }, include: { enquiry: { select: { apm: true, offerPdfGeneratedAt: true } } } });
  if (!it || isEnquiryFrozen(it.enquiry.apm, it.enquiry.offerPdfGeneratedAt)) return null;
  const linked = hasActuatorLink(it);
  if (isActuatorCandidate(it)) {
    // A legacy candidate with no link keeps its cost until Fetch Actuator; only a newly-becoming candidate is auto-linked.
    if (!linked && isActuatorCandidate(before)) return null;
    return applyActuatorToItem(itemId, linked && deriveMapKey(before) !== deriveMapKey(it) ? { actCode: null, gbCode: null } : {}, manualTotal);
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
