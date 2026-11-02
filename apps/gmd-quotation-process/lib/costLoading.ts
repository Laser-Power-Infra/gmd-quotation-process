// Cost loading: how much the cost engine adds on top of product cost.
//   cost = productCost * BASE_COST_FACTOR * (1 + payment% + inspection% + PBG% + transport%) + extension + bypass
// lib/costCalculator.ts applies it; this file holds the pure pieces so the table can
// show the loading % next to cost with exactly the same numbers. Formulas are unchanged.

export const BASE_COST_FACTOR = 1.08;
/** Product cost at or above this uses the full-load transport rate. */
export const FULL_LOAD_THRESHOLD = 5_000_000;

/** "2.00%" -> 0.02. Unparseable or blank -> 0 (same as the cost engine). */
export function parseCostPct(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return parseFloat(String(raw).replace(/%/g, "").trim()) / 100 || 0;
}

export function normalizeStateName(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  let s = raw.trim().toUpperCase().replace(/\s+/g, " ");

  // Strip "FOR (SITE IN ...)" prefix if present
  const prefixMatch = s.match(/^FOR\s*\(\s*SITE\s+IN\s+(.+?)\s*\)$/i);
  if (prefixMatch) {
    s = prefixMatch[1].trim();
  } else if (s === "FOR (SITE)") {
    return "FOR (Site)";
  }

  // Common spelling variants / aliases
  if (s === "CHATTISGARH") return "CHHATTISGARH";
  if (s === "UTTRAKHAND") return "UTTARAKHAND";
  if (s === "PONDICHERRY") return "PUDUCHERRY";
  if (s === "JAMMU & KASHMIR" || s === "JAMMU AND KASHMIR") return "J&K";
  if (s === "ANDAMAN & NICOBAR" || s === "ANDAMAN AND NICOBAR") return "ANDAMAN";

  return s;
}

/** Candidate TransportationCost keys for a docket state, in the order the cost engine tries them. */
export function transportStateKeys(state: string | null | undefined): string[] {
  if (!state || state === "-") return [];
  const raw = state.trim();
  const keys = [raw];
  const normalized = normalizeStateName(raw);
  if (normalized) keys.push(normalized, `FOR (Site In ${normalized})`);
  return keys;
}

/** The add-on lookup tables, keyed exactly as stored (PaymentTermsCost.terms etc.). */
export type CostLoadingTables = {
  paymentTerms: Record<string, string>;
  inspection: Record<string, string>;
  pbg: Record<string, string>;
  transport: Record<string, { fullLoad: string; partLoad: string }>;
};

export type CostLoadingTerms = {
  paymentTerms?: string | null;
  inspection?: string | null;
  pbg?: string | null;
  state?: string | null;
};

export type CostLoading = {
  paymentPct: number;
  inspectionPct: number;
  pbgPct: number;
  transportPct: number;
  /** Sum of the four add-on fractions (the cost engine's pctMultiplier). */
  multiplier: number;
  /** Total loading over product cost in percent, base factor included: 9.08 for 1.0908. */
  loadingPct: number;
};

/** Loading over product cost (percent) for a given add-on multiplier. */
export function loadingPctFromMultiplier(multiplier: number): number {
  return parseFloat(((BASE_COST_FACTOR * (1 + multiplier) - 1) * 100).toFixed(2));
}

function termPct(table: Record<string, string>, key: string | null | undefined): number {
  if (!key || key === "-") return 0;
  return Object.prototype.hasOwnProperty.call(table, key) ? parseCostPct(table[key]) : 0;
}

export function computeCostLoading(
  terms: CostLoadingTerms,
  productCost: number | null | undefined,
  tables: CostLoadingTables,
): CostLoading {
  const paymentPct = termPct(tables.paymentTerms, terms.paymentTerms);
  const inspectionPct = termPct(tables.inspection, terms.inspection);
  const pbgPct = termPct(tables.pbg, terms.pbg);

  let transportPct = 0;
  const row = transportStateKeys(terms.state)
    .map((k) => (Object.prototype.hasOwnProperty.call(tables.transport, k) ? tables.transport[k] : undefined))
    .find(Boolean);
  if (row) {
    const isFullLoad = (productCost ?? 0) >= FULL_LOAD_THRESHOLD;
    transportPct = parseCostPct(isFullLoad ? row.fullLoad : row.partLoad);
  }

  const multiplier = paymentPct + inspectionPct + pbgPct + transportPct;
  return { paymentPct, inspectionPct, pbgPct, transportPct, multiplier, loadingPct: loadingPctFromMultiplier(multiplier) };
}

export function formatLoadingPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

/** Per-part breakdown for a tooltip. */
export function describeCostLoading(l: CostLoading): string {
  const p = (n: number) => `${(n * 100).toFixed(2)}%`;
  return (
    `Cost loading ${formatLoadingPct(l.loadingPct)} over product cost = ` +
    `x${BASE_COST_FACTOR} x (1 + payment ${p(l.paymentPct)} + inspection ${p(l.inspectionPct)} + PBG ${p(l.pbgPct)} + transport ${p(l.transportPct)}), ` +
    `plus flat extension/bypass costs.`
  );
}
