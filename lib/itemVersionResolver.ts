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

export interface ItemVersionResult {
  baseItem: string | null;
  hasVersionExtras: boolean;
  v1: string;
  v2: string;
  v3: string;
  v4: string;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function findBaseItem(normalized: string): string | null {
  const sorted = [...BASE_ITEMS].sort((a, b) => b.length - a.length);
  for (const base of sorted) {
    if (normalized.includes(base)) return base;
  }
  return null;
}

export function parseItem(item: string | null | undefined): ItemVersionResult {
  const empty: ItemVersionResult = {
    baseItem: null,
    hasVersionExtras: false,
    v1: "",
    v2: "",
    v3: "",
    v4: "",
  };
  if (!item) return empty;

  const normalized = normalize(item);
  if (!normalized) return empty;

  const baseItem = findBaseItem(normalized);
  if (!baseItem) return empty;

  const has9523 = /\b9523\b/.test(normalized);
  const hasRising = /\bRISING\b/.test(normalized);
  const hasWafer = /\bWAFER\b/.test(normalized);
  const hasDi = /\bDI\b/.test(normalized);
  const hasCs = /\bCS\b/.test(normalized);

  const isSlvType = SLV_TYPES.has(baseItem);

  const result: ItemVersionResult = {
    baseItem,
    hasVersionExtras: has9523 || hasRising || hasWafer || hasDi || hasCs,
    v1: "",
    v2: "",
    v3: "",
    v4: "",
  };

  if (hasRising && has9523) {
    result.v4 = "RISING 9523";
  } else if (hasDi) {
    result.v1 = "DI";
  } else if (hasCs) {
    result.v2 = "CS";
  } else if (has9523) {
    if (isSlvType) {
      result.v2 = "9523";
    } else {
      result.v4 = "9523";
    }
  } else if (hasRising) {
    result.v3 = "RISING";
  } else if (hasWafer) {
    result.v3 = "WAFER";
  }

  return result;
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

function joinMarkers(values: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.join(", ");
}

export function planIndentRecompute(rows: IndentRecomputeInput[]): IndentRecomputePlan {
  const groups = new Map<
    string,
    IndentRecomputeInput[]
  >();

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
    const v1: string[] = [];
    const v2: string[] = [];
    const v3: string[] = [];
    const v4: string[] = [];

    for (const row of members) {
      const p = parseItem(row.item);
      if (p.v1) v1.push(p.v1);
      if (p.v2) v2.push(p.v2);
      if (p.v3) v3.push(p.v3);
      if (p.v4) v4.push(p.v4);
      const n = Number(row.totalBalBillAgCont);
      total += Number.isFinite(n) ? n : 0;
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
      v1: joinMarkers(v1),
      v2: joinMarkers(v2),
      v3: joinMarkers(v3),
      v4: joinMarkers(v4),
    });

    for (const row of members) {
      if (row.id !== survivor.id) deletes.push(row.id);
    }
  }

  return { updates, deletes };
}