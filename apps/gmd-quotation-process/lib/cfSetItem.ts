import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import { recalculateItem } from "@/lib/costCalculator";
import { isEnquiryFrozen } from "@/lib/oneClickAccess";
import { loadRates } from "@/lib/rateLookup";
import { computeCfSet, gasketFields, type CfRates } from "@/lib/cfSet";
import { buildDensityMap, parseNumber } from "@/lib/technical/formulas";

/** DB side of the CF set: keeps one child "CF SET" EnquiryItem under each valve whose Others are ticked. */

const CASTING_KEYS = ["DI", "CS", "CI", "SS", "Bronze", "MS", "GI"] as const;

const nums = (r: Record<string, string>) =>
  Object.fromEntries(Object.entries(r).flatMap(([k, v]) => { const n = parseNumber(v); return n == null ? [] : [[k, n]]; }));

export async function loadCfContext() {
  const [flanges, densityRows, flange, fastener, gasket, machining, casting] = await Promise.all([
    prisma.flange.findMany({
      select: {
        rowIndex: true, size: true, moc: true, pnRatingClass: true, standards: true, idMm: true, odMm: true, pcdMm: true,
        noOfHoleNos: true, holeDia: true, thicknessOfFlange: true, totalWeightKg: true, boltWeight: true, nutWeight: true,
      },
    }),
    prisma.density.findMany({ select: { material: true, densityGmCm3: true } }),
    loadRates("CF_FLANGE_RATE", ["MS", "CS", "CI", "DI", "SS"]),
    loadRates("CF_FASTENER_RATE", ["GI", "CS", "SS", "AS"]),
    loadRates("CF_GASKET_RATE", ["RUBBER", "CAF"]),
    loadRates("CF_MACHINING", ["<=100", "150-300", "350-600", ">600"]),
    loadRates("GMD_CASTING_RATE", CASTING_KEYS),
  ]);
  // A blank CF flange/fastener rate falls back to the casting rate of the same key, so quoting works before the CF rates are filled.
  const withFallback = (own: Record<string, string>) => ({ ...nums(casting.rates), ...nums(own) });
  const rates: CfRates = {
    flange: withFallback(flange.rates),
    fastener: withFallback(fastener.rates),
    gasket: nums(gasket.rates),
    machining: nums(machining.rates),
  };
  return { flanges, rates, densities: buildDensityMap(densityRows) };
}

type CfContext = Awaited<ReturnType<typeof loadCfContext>>;

/** Create/update/delete the CF set child of a valve from its Others ticks. Frozen enquiries are skipped. */
export async function ensureCfSetItem(valveId: string, opts: { resetMoc?: boolean; ctx?: CfContext } = {}) {
  const valve = await prisma.enquiryItem.findUnique({
    where: { id: valveId },
    include: { enquiry: { select: { apm: true, offerPdfGeneratedAt: true } } },
  });
  if (!valve || valve.parentItemId) return;
  if (isEnquiryFrozen(valve.enquiry.apm, valve.enquiry.offerPdfGeneratedAt)) return;

  // Legacy valves costed with the removed flat "Others" add-on would double count next to the CF child: strip it once.
  if (valve.othersCost != null) {
    await prisma.enquiryItem.update({ where: { id: valveId }, data: { othersCost: null } });
    await recalculateItem(valveId);
  }

  const child = await prisma.enquiryItem.findFirst({ where: { parentItemId: valveId } });
  const ctx = valve.others.length ? (opts.ctx ?? (await loadCfContext())) : null;
  // The child's MOC is editable (MS -> CS), so keep it unless the valve's own MOC just changed.
  const res = ctx
    ? computeCfSet(valve, ctx.flanges, ctx.rates, ctx.densities, {
        flangeMoc: child?.moc && !opts.resetMoc ? child.moc : undefined,
      })
    : null;

  if (!res || (res.lines.length === 0 && res.missing.length === 0)) {
    if (child) await prisma.enquiryItem.deleteMany({ where: { parentItemId: valveId } });
    return;
  }

  const parts = res.lines.map((l) => `${l.qty} ${l.part}`).join(" + ");
  const priced = res.lines.length > 0;
  const data = {
    itemName: `CF set for ${valve.itemName}${parts ? ` — ${parts}` : ""}`,
    itemType: "CF SET",
    quantity: valve.quantity,
    moc: res.flangeMoc,
    size: valve.size,
    pnRating: valve.pnRating,
    productCost: priced ? res.total : null,
    ...(priced ? {} : { cost: null }),
    costRefCode: res.flangeRowIndex != null ? `FLANGE#${res.flangeRowIndex}` : null,
    deliverySchedule: valve.deliverySchedule,
    cfSetBreakdown: res as unknown as Prisma.InputJsonObject,
  };

  let childId = child?.id;
  if (child) {
    await prisma.enquiryItem.update({ where: { id: child.id }, data });
  } else {
    // Slot the child right under its valve so every orderBy-position view (table, PDF, exports) shows it there.
    try {
      const [, created] = await prisma.$transaction([
        prisma.enquiryItem.updateMany({
          where: { enquiryId: valve.enquiryId, position: { gt: valve.position } },
          data: { position: { increment: 1 } },
        }),
        prisma.enquiryItem.create({
          data: { ...data, enquiryId: valve.enquiryId, parentItemId: valve.id, position: valve.position + 1, vaPercent: valve.vaPercent },
        }),
      ]);
      childId = created.id;
    } catch (e) {
      // Concurrent call already created the child (unique parentItemId): update it instead.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      const existing = await prisma.enquiryItem.findFirst({ where: { parentItemId: valveId } });
      if (!existing) throw e;
      await prisma.enquiryItem.update({ where: { id: existing.id }, data });
      childId = existing.id;
    }
  }
  if (priced && childId) await recalculateItem(childId);
}

/** Rewrite the Flange tab's gasket weight/cost columns from the current RUBBER rate (same helper as scripts/compute-flange-weight.ts). */
export async function refreshFlangeGaskets(): Promise<void> {
  const rate = parseNumber((await loadRates("CF_GASKET_RATE", ["RUBBER"])).rates.RUBBER);
  const rows = await prisma.flange.findMany({ select: { id: true, idMm: true, pcdMm: true, holeDia: true, gasketWeightKg: true, gasketCost: true } });
  for (const r of rows) {
    const f = gasketFields(r, rate);
    if ((r.gasketWeightKg ?? "") !== f.gasketWeightKg || (r.gasketCost ?? "") !== f.gasketCost) {
      await prisma.flange.update({ where: { id: r.id }, data: f });
    }
  }
}

/** Re-price every CF set (and backfill valves that have Others ticked but no child yet): call after a rate change. */
export async function recomputeCfSets(): Promise<number> {
  const valves = await prisma.enquiryItem.findMany({
    where: { parentItemId: null, others: { isEmpty: false } },
    select: { id: true },
  });
  if (valves.length === 0) return 0;
  const ctx = await loadCfContext();
  for (const v of valves) await ensureCfSetItem(v.id, { ctx });
  return valves.length;
}
