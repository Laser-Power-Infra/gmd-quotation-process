import { prisma } from "@/lib/prisma";
import { LIVE_RM_WHERE } from "@/lib/indentRmCodeResolver";

/**
 * Flat cost added to an item's Cost for its ticked "Others" options, sourced
 * from the technical data:
 *  - flange        -> 1 x Flange.costAsPerIs
 *  - gasket        -> 2 x RawMaterial.cost (L4 = GASKET, L8 ~ RUBBER, size match)
 *  - nut and bolt  -> 2 x Flange.boltCost + 1 x Flange.nutCost
 * Rows are matched by the item's size / MOC / PN rating; among several matches
 * the costliest wins (safe-side quoting). `complete` is false when a ticked
 * component found no cost — the cost sanity warning picks that up.
 */

export type OthersCostResult = { cost: number; complete: boolean };

export type FlangeCostRow = {
  size: string | null;
  moc: string | null;
  pnRatingClass: string | null;
  costAsPerIs: string | null;
  boltCost: string | null;
  nutCost: string | null;
};

export type GasketCostRow = {
  l3Dia: string | null;
  l4Component: string | null;
  cost: number;
};

/** First number in free text: "DN 50", "50MM", "PN-10/16" -> "50"/"50"/"10". */
// shortcut: a "PN-10/16" rating matches on 10 only; split-rating rows need a real parser if they ever differ in cost.
export function firstNumberKey(value: string | null | undefined): string | null {
  return /[0-9]+(?:\.[0-9]+)?/.exec(String(value ?? ""))?.[0] ?? null;
}

const MOC_ALIASES: Record<string, string> = {
  "CAST IRON": "CI",
  "DUCTILE IRON": "DI",
  "CARBON STEEL": "CS",
  "CAST STEEL": "CS",
  "STAINLESS STEEL": "SS",
  "MILD STEEL": "MS",
  "GALVANIZED IRON": "GI",
  GALVANIZED: "GI",
  GALVANISED: "GI",
};

/** "C.I." / "Cast Iron" / "CI" all collapse to "CI". */
export function mocKey(value: string | null | undefined): string {
  const n = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  return MOC_ALIASES[n] ?? n;
}

/** Items store combined MOCs ("DUCTILE IRON/CAST IRON"): each half is acceptable. */
export function mocKeys(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split("/")
      .map((p) => mocKey(p))
      .filter(Boolean),
  );
}

function parseCost(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pure matching core, separated from the DB reads for testing. */
export function computeOthersCostFromRows(
  item: { others: string[]; size: string | null; moc: string | null; pnRating: string | null },
  flangeRows: FlangeCostRow[],
  gasketRows: GasketCostRow[],
): OthersCostResult {
  const wants = item.others.map((o) => String(o).toUpperCase());
  const wantFlange = wants.some((o) => o.includes("FLANGE"));
  const wantGasket = wants.some((o) => o.includes("GASKET"));
  const wantNutBolt = wants.some((o) => o.includes("BOLT") || o.includes("NUT"));
  if (!wantFlange && !wantGasket && !wantNutBolt) return { cost: 0, complete: true };

  const sizeKey = firstNumberKey(item.size);
  const itemMocs = mocKeys(item.moc);
  const pnKey = firstNumberKey(item.pnRating);

  const flangeMatches = flangeRows.filter(
    (r) =>
      sizeKey !== null &&
      firstNumberKey(r.size) === sizeKey &&
      itemMocs.has(mocKey(r.moc)) &&
      (pnKey === null || firstNumberKey(r.pnRatingClass) === pnKey),
  );

  let cost = 0;
  let complete = true;
  const costliest = (values: (number | null)[]): number | null =>
    values.reduce<number | null>((best, v) => (v !== null && (best === null || v > best) ? v : best), null);

  if (wantFlange) {
    const best = costliest(flangeMatches.map((r) => parseCost(r.costAsPerIs)));
    if (best === null) complete = false;
    else cost += best;
  }

  if (wantNutBolt) {
    const best = costliest(
      flangeMatches.map((r) => {
        const bolt = parseCost(r.boltCost);
        const nut = parseCost(r.nutCost);
        return bolt === null || nut === null ? null : 2 * bolt + 1 * nut;
      }),
    );
    if (best === null) complete = false;
    else cost += best;
  }

  if (wantGasket) {
    const matches = gasketRows.filter(
      (r) =>
        sizeKey !== null &&
        firstNumberKey(r.l3Dia) === sizeKey &&
        String(r.l4Component ?? "").trim().toUpperCase() === "GASKET",
    );
    const best = costliest(matches.map((r) => parseCost(r.cost)));
    if (best === null) complete = false;
    else cost += 2 * best;
  }

  return { cost: parseFloat(cost.toFixed(2)), complete };
}

export async function computeOthersCost(item: {
  others: string[];
  size: string | null;
  moc: string | null;
  pnRating: string | null;
}): Promise<OthersCostResult> {
  if (!item.others?.length) return { cost: 0, complete: true };

  const [flangeRows, gasketRows] = await Promise.all([
    prisma.flange.findMany({
      select: { size: true, moc: true, pnRatingClass: true, costAsPerIs: true, boltCost: true, nutCost: true },
    }),
    prisma.rawMaterial.findMany({
      where: {
        ...LIVE_RM_WHERE,
        l8ItemCategory: { contains: "RUBBER", mode: "insensitive" },
        cost: { gt: 0 },
      },
      select: { l3Dia: true, l4Component: true, cost: true },
    }),
  ]);

  return computeOthersCostFromRows(item, flangeRows, gasketRows.map((r) => ({
    l3Dia: r.l3Dia,
    l4Component: r.l4Component,
    cost: Number(r.cost),
  })));
}
