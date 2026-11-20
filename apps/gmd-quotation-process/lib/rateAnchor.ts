import { rateFor, vaFrom, type CostSplit } from "./vaRules";

/**
 * Decides which of VA% / quotedRate anchors the price when cost changes.
 *
 * - Default (validation !== "Yes"): VA% is held constant, quotedRate is derived.
 *   If VA% is blank, fall back to deriving VA% from the existing quotedRate.
 * - validation === "Yes": the validated quotedRate is frozen, VA% absorbs the change.
 * - Actuated item: `split` (lib/vaRules.ts splitLoadedCost); VA% is the valve VA%, the actuator portion gets 5%.
 */
export function resolveCostChangeAnchor(input: {
  cost: number;
  quotedRate: number | null;
  vaPercent: number | null;
  validation?: string | null;
  split?: CostSplit;
}): { quotedRate: number | null; vaPercent: number | null } {
  let quotedRate = input.quotedRate;
  let vaPercent = input.vaPercent;
  const split = input.split ?? { valveCost: input.cost, actCost: 0 };

  if (input.cost <= 0) return { quotedRate, vaPercent };

  if (input.validation === "Yes") {
    if (quotedRate !== null && quotedRate > 0) {
      vaPercent = vaFrom(quotedRate, split);
    }
    return { quotedRate, vaPercent };
  }

  if (vaPercent !== null) {
    quotedRate = rateFor(split, vaPercent);
  } else if (quotedRate !== null && quotedRate > 0) {
    vaPercent = vaFrom(quotedRate, split);
  }
  return { quotedRate, vaPercent };
}

/** A sent offer is out of date once its quoted rate moves (compared at the stored 2-dp precision). */
export function isOfferRevision(emailSentBy: string | null, oldRate: number | null, newRate: number | null): boolean {
  return !!emailSentBy && (oldRate?.toFixed(2) ?? null) !== (newRate?.toFixed(2) ?? null);
}
