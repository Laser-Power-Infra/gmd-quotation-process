export const BASE_ITEMS = [
  "SLV",
  "TPAV+SLV",
  "SLV METAL",
  "BFV",
  "DPCV",
  "CF",
  "DV",
  "GV",
  "NRV",
  "PRV",
  "TPAV",
] as const;

export const SLV_TYPES = new Set<string>(["SLV", "TPAV+SLV", "SLV METAL"]);

export type VersionSlot = 1 | 2 | 3 | 4;

export type VariantKey =
  | "PLAIN"
  | "9523"
  | "RISING"
  | "RISING_9523"
  | "DI"
  | "CS"
  | "WAFER"
  | "OTHER";

export interface ItemVersionResult {
  baseItem: string | null;
  slot: VersionSlot | null;
  variant: VariantKey | null;
  hasVersionExtras: boolean;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

// Compound names must be resolved before the plain token rules below, because
// e.g. "TPAV+RISING SLV" contains both "TPAV" and "SLV", and "SLV RISING-METAL"
// contains "SLV" but actually belongs to the SLV METAL base item.
const COMPOUND_BASE_RULES: Array<{ test: (n: string) => boolean; base: string }> = [
  {
    test: (n) =>
      n.includes("TPAV+SLV") ||
      n.includes("TPAV+RISING SLV") ||
      n.includes("TPAV+CS SLV"),
    base: "TPAV+SLV",
  },
  {
    test: (n) =>
      n.includes("SLV METAL") || n.includes("SLV RISING-METAL") || n.includes("SLV-METAL"),
    base: "SLV METAL",
  },
];

// Token rules use word boundaries so abbreviations embedded in unrelated names
// (e.g. "KGV" containing "GV") are not misdetected.
const TOKEN_BASE_RULES: Array<{ test: (n: string) => boolean; base: string }> = [
  { test: (n) => /\bSLV\b/.test(n) || n.includes("SLUICE VALVE"), base: "SLV" },
  { test: (n) => /\bBFV\b/.test(n) || n.includes("BUTTERFLY"), base: "BFV" },
  { test: (n) => /\bDPCV\b/.test(n), base: "DPCV" },
  { test: (n) => /\bCF\b/.test(n), base: "CF" },
  { test: (n) => /\bDV\b/.test(n) || n.includes("DIAPHRAGM"), base: "DV" },
  { test: (n) => /\bGV\b/.test(n) || n.includes("GLOBE"), base: "GV" },
  { test: (n) => /\bNRV\b/.test(n), base: "NRV" },
  { test: (n) => /\bPRV\b/.test(n), base: "PRV" },
  { test: (n) => /\bTPAV\b/.test(n), base: "TPAV" },
];

function findBaseItem(normalized: string): string | null {
  for (const rule of COMPOUND_BASE_RULES) {
    if (rule.test(normalized)) return rule.base;
  }
  for (const rule of TOKEN_BASE_RULES) {
    if (rule.test(normalized)) return rule.base;
  }
  return null;
}

interface VariantFlags {
  has9523: boolean;
  hasRising: boolean;
  hasWafer: boolean;
  hasDi: boolean;
  hasCs: boolean;
}

/**
 * Resolve which version column (V1..V4) a given item name belongs to.
 *
 * Rules per base item:
 *  - SLV / TPAV+SLV / SLV METAL: V1 = plain, V2 = 9523, V3 = RISING,
 *    V4 = RISING + 9523.
 *  - BFV: V1 = plain, V2 = DI, V3 = WAFER, V4 = 9523.
 *  - DPCV: V1 = plain/DI, V2 = CS, V3 = spare, V4 = 9523.
 *  - NRV / TPAV: V1 = plain/DI, V2 = spare, V4 = 9523.
 *  - CF / DV / GV / PRV: V1 = plain, V2 = spare.
 *
 * Any recognized suffix that a base item does not explicitly map falls into
 * that item's spare column (or V1 when it has no spare column).
 */
function resolveSlot(
  baseItem: string,
  flags: VariantFlags,
): { slot: VersionSlot; variant: VariantKey } {
  const { has9523, hasRising, hasWafer, hasDi, hasCs } = flags;
  const noExtras = !(has9523 || hasRising || hasWafer || hasDi || hasCs);

  if (noExtras) return { slot: 1, variant: "PLAIN" };

  if (SLV_TYPES.has(baseItem)) {
    if (hasRising && has9523) return { slot: 4, variant: "RISING_9523" };
    if (hasRising) return { slot: 3, variant: "RISING" };
    if (has9523) return { slot: 2, variant: "9523" };
    return { slot: 1, variant: "OTHER" };
  }

  if (baseItem === "BFV") {
    if (has9523) return { slot: 4, variant: "9523" };
    if (hasWafer) return { slot: 3, variant: "WAFER" };
    if (hasDi) return { slot: 2, variant: "DI" };
    return { slot: 1, variant: "OTHER" };
  }

  if (baseItem === "DPCV") {
    if (has9523) return { slot: 4, variant: "9523" };
    if (hasCs) return { slot: 2, variant: "CS" };
    if (hasDi) return { slot: 1, variant: "DI" };
    return { slot: 3, variant: "OTHER" };
  }

  if (baseItem === "NRV" || baseItem === "TPAV") {
    if (has9523) return { slot: 4, variant: "9523" };
    if (hasDi) return { slot: 1, variant: "DI" };
    return { slot: 2, variant: "OTHER" };
  }

  // CF / DV / GV / PRV: only the plain base is mapped; other suffixes are spare.
  return { slot: 2, variant: "OTHER" };
}

export function parseItem(item: string | null | undefined): ItemVersionResult {
  const empty: ItemVersionResult = {
    baseItem: null,
    slot: null,
    variant: null,
    hasVersionExtras: false,
  };
  if (!item) return empty;

  const normalized = normalize(item);
  if (!normalized) return empty;

  const baseItem = findBaseItem(normalized);
  if (!baseItem) return empty;

  const flags: VariantFlags = {
    has9523: /\b9523\b/.test(normalized),
    hasRising: /\bRISING\b/.test(normalized),
    hasWafer: /\bWAFER\b/.test(normalized),
    hasDi: /\bDI\b/.test(normalized),
    hasCs: /\bCS\b/.test(normalized),
  };

  const { slot, variant } = resolveSlot(baseItem, flags);

  return {
    baseItem,
    slot,
    variant,
    hasVersionExtras:
      flags.has9523 ||
      flags.hasRising ||
      flags.hasWafer ||
      flags.hasDi ||
      flags.hasCs,
  };
}

export interface IndentRecomputeInput {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
  totalBalBillAgCont: number | null;
}

export interface IndentRecomputeUpdate {
  id: string;
  item: string;
  totalBalBillAgCont: number;
  v1: string;
  v2: string;
  v3: string;
  v4: string;
}

export interface IndentRecomputePlan {
  updates: IndentRecomputeUpdate[];
  deletes: string[];
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function formatAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function planIndentRecompute(rows: IndentRecomputeInput[]): IndentRecomputePlan {
  const groups = new Map<string, IndentRecomputeInput[]>();

  for (const row of rows) {
    const parsed = parseItem(row.item);
    if (!parsed.baseItem) continue;

    const key = [
      parsed.baseItem,
      normalizeKeyPart(row.size),
      normalizeKeyPart(row.pnRating),
      normalizeKeyPart(row.mcReceivedPending),
    ].join("||");

    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const updates: IndentRecomputeUpdate[] = [];
  const deletes: string[] = [];

  for (const members of groups.values()) {
    const parsed = parseItem(members[0].item);
    const baseItem = parsed.baseItem as string;

    let total = 0;
    const slotSums = [0, 0, 0, 0];
    const slotPresent = [false, false, false, false];

    for (const row of members) {
      const p = parseItem(row.item);
      const n = Number(row.totalBalBillAgCont);
      const value = Number.isFinite(n) ? n : 0;
      total += value;

      if (p.slot !== null) {
        slotSums[p.slot - 1] += value;
        slotPresent[p.slot - 1] = true;
      }
    }

    let survivor = members[0];
    for (const row of members) {
      if (normalizeKeyPart(row.item) === normalizeKeyPart(baseItem)) {
        survivor = row;
        break;
      }
    }

    updates.push({
      id: survivor.id,
      item: baseItem,
      totalBalBillAgCont: total,
      v1: slotPresent[0] ? formatAmount(slotSums[0]) : "",
      v2: slotPresent[1] ? formatAmount(slotSums[1]) : "",
      v3: slotPresent[2] ? formatAmount(slotSums[2]) : "",
      v4: slotPresent[3] ? formatAmount(slotSums[3]) : "",
    });

    for (const row of members) {
      if (row.id !== survivor.id) deletes.push(row.id);
    }
  }

  return { updates, deletes };
}
