// GM R&D pricing rules (Puja Agarwal, 2026-11-02). One table, read by the red-row check
// and by the "Apply VA% rules" action. Rate = Contract Review (CR) rate, but VA% never
// drops below the minimum for the item and is never negative.
import { parseSize } from "./vaValidation";

export interface VaItem {
  itemType?: string | null;
  itemName?: string | null;
  size?: string | null;
  cost?: number | null;
  quotedRate?: string | null;
  vaPercent?: number | null;
  contractReviewRate?: string | null;
}

// shortcut: seat type is not a field on EnquiryItem. Sluice carries it in itemType
// (METAL / RESILIENT); check valve is metal-seated only when the item name says so.
// Upgrade when a seat field is added.
const METAL_SEATED_CHECK = /metal[\s-]*seat/i;

/** Minimum VA% for the item; 0 when no rule applies (so VA% is still never negative). */
export function minVaPercent(it: VaItem): number {
  const type = (it.itemType ?? "").toUpperCase().trim();
  const dn = parseSize(it.size);
  if (type.startsWith("SLUICE VALVE-METAL")) return 30;
  if (type.startsWith("SLUICE VALVE-RESILIENT")) return 15;
  if (type === "CHECK VALVE") return METAL_SEATED_CHECK.test(it.itemName ?? "") ? 30 : 0;
  if (type === "BUTTERFLY VALVE") return dn !== null && dn > 450 ? 35 : 20;
  if (type === "TPAV" || type === "TPV") return 35;
  if (type === "EXPANSION BELOWS") return dn !== null && dn > 1000 ? 45 : 0;
  if (type === "DPCV") return dn !== null && dn > 600 ? 35 : 20;
  return 0;
}

const num = (v: string | null | undefined) => parseFloat((v ?? "").replace(/[^0-9.]/g, ""));
const EPS = 0.005;
const floorRate = (it: VaItem) => Math.ceil(it.cost! * (1 + minVaPercent(it) / 100) * 100) / 100;

/**
 * Rate the rules want: CR rate (else the current rate), capped at the previous rate quoted
 * to the same party, then lifted to the minimum-VA% rate. The minimum wins over the cap.
 */
export function vaRuleRate(it: VaItem, previousRate?: number | null): number | null {
  const quoted = num(it.quotedRate);
  const cr = num(it.contractReviewRate);
  if (!(it.cost! > 0)) return null;
  const base = cr > 0 ? cr : quoted > 0 ? quoted : floorRate(it);
  return Math.max(floorRate(it), previousRate && previousRate > 0 ? Math.min(base, previousRate) : base);
}

/** Red row: VA% below the minimum (or negative), or rate above the CR rate. No upper VA% limit. */
export function isVaRuleViolation(it: VaItem): boolean {
  if (it.vaPercent == null || !(it.cost! > 0)) return false;
  if (it.vaPercent < minVaPercent(it) - EPS) return true;
  const quoted = num(it.quotedRate);
  const cr = num(it.contractReviewRate);
  return cr > 0 && quoted > Math.max(cr, floorRate(it)) + EPS;
}
