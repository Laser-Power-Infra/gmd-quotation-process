/**
 * Major Head derivation for the Raw Material page. The L8 -> head and
 * L2 -> head mappings live in LookupOption rows (types below) as
 * "<L8 or L2>=<HEAD>" so they can be edited at /admin/lookup-options.
 * Blank or unmapped values land in UNCLASSIFIED, so every item has exactly
 * one head of each kind.
 */

export const MAJOR_HEAD_L8_TYPE = "RM_MAJOR_HEAD_L8";
export const MAJOR_HEAD_L2_TYPE = "RM_MAJOR_HEAD_L2";
export const UNCLASSIFIED_HEAD = "UNCLASSIFIED";

export const MAJOR_HEAD_ITEM_TYPE_HEADER = "MAJOR HEAD (Item Type)";
export const MAJOR_HEAD_VALVE_TYPE_HEADER = "MAJOR HEAD (Valve Type)";
export const COST_BASIS_HEADER = "COST BASIS";

export type HeadMap = Map<string, string>;

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** LookupOption values "<key>=<head>" -> map keyed by the normalised key. */
export function parseHeadMap(values: string[]): HeadMap {
  const map: HeadMap = new Map();
  for (const v of values) {
    const eq = v.indexOf("=");
    if (eq === -1) continue;
    const key = norm(v.slice(0, eq));
    const head = v.slice(eq + 1).trim();
    if (key && head) map.set(key, head);
  }
  return map;
}

export function headOf(map: HeadMap, value: unknown): string {
  return map.get(norm(value)) ?? UNCLASSIFIED_HEAD;
}

export const COST_BASIS = {
  weight: "Weight x Cast rate",
  weightMissing: "Weight missing",
  supplier: "Supplier price",
  missing: "Missing",
} as const;
export type CostBasis = (typeof COST_BASIS)[keyof typeof COST_BASIS];

/**
 * How an item's COST is (or should be) derived. `isCasting` is whether the
 * item is priced by weight x cast rate (see getCastingKey in rawMaterialView).
 */
export function costBasisOf(
  isCasting: boolean,
  pcsWgt: unknown,
  cost: number | null | undefined,
): CostBasis {
  if (isCasting) {
    const w = parseFloat(String(pcsWgt ?? "").replace(/,/g, ""));
    return Number.isFinite(w) && w > 0 ? COST_BASIS.weight : COST_BASIS.weightMissing;
  }
  return cost != null && Number.isFinite(cost) ? COST_BASIS.supplier : COST_BASIS.missing;
}
