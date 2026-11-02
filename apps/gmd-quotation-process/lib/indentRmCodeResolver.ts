import { pnRatingBucket } from "./pnRatingMatcher";
import { VALVE_TYPES_BY_INDENT_ITEM } from "./indentItemValveTypes";

/**
 * Links Indent Listing rows to the raw material master (GMDUpdateItem) and
 * records the matching ERP item code (the RM code) against each V1..V4 column.
 * Rules come from Puja's "Mapping Logic" sheet:
 *
 *  - Item -> L2 VALVE TYPE (see RM_CODE_CONFIG_BY_ITEM); SLV / SLV METAL also
 *    pin L4 (METAL TO RUBBER / METAL TO METAL); NRV is SWING TYPE only.
 *  - Size -> L3 exact; PN -> L7 through `pnRatingBucket`.
 *  - The slot's stored CATEGORY (Base / 9523 / Rising / Rising 9523 / CS /
 *    Wafer, comma separated for several) drives the attributes, not the slot
 *    number. A blank category falls back to the slot's usual one. 9523, rising,
 *    wafer and DI-vs-CS must match exactly. Base is ductile iron.
 *  - L8 must be TRADING VALVES; L4 SAMPLE FOR BIS / BONNET / DISC / COVER is
 *    never the indent item; only live rows (the caller filters newItemStatus).
 *  - ONE code is picked per (slot, category): TV- named first, item preference
 *    (BFV BLANK BASE, DPCV metal-to-rubber, PRV control-diaphragm), exact PN
 *    before alternate PN, stock > 0, then code order.
 *  - TPAV is one model for every PN / variant (size only; 20/25 mm use the
 *    12.5 small-orifice master) and also gets the isolating sluice valve of the
 *    same size / PN / category appended: "<tpav>, <slv>".
 *  - BFV 700 / 800 and every CS BFV are GMD production items: left blank.
 *  - Air cushion has no PN-16 master, so it reuses the CLASS 150# codes.
 */

/** L2-VALVE TYPE the sluice valve raw materials carry. */
export const RM_CODE_VALVE_TYPE = "SLUICE VALVE";

/** L2-VALVE TYPE the non-return (check) valve raw materials carry. */
export const RM_CODE_CHECK_VALVE_TYPE = "CHECK VALVE";

/** Every L2-VALVE TYPE the resolver understands (the shared item map's values). */
export const RM_CODE_VALVE_TYPES: readonly string[] = [
  ...new Set(Object.values(VALVE_TYPES_BY_INDENT_ITEM).flat()),
];

/** A raw material is live when its status is blank or "Updated" (CLOSED / TO BE CLOSED are not). */
export const LIVE_RM_WHERE = {
  OR: [{ newItemStatus: null }, { newItemStatus: "Updated" }],
};

/** Substring of the L8 -ITEM CATEGORY value, which is "TRADING VALVES". */
export const RM_CODE_ITEM_CATEGORY = "TRADING VALVE";

/** L5- MATERIAL required by a "CS" category; everything else needs ductile iron. */
export const RM_CODE_CARBON_STEEL = "CARBON STEEL/CAST STEEL";
const DUCTILE_IRON = "DUCTILE IRON";

interface PreparedRm {
  code: string;
  isTv: boolean;
  valveType: string;
  size: string;
  component: string;
  material: string;
  stdNorm: string;
  rising: boolean;
  nine: boolean;
  wafer: boolean;
  pnBucket: string;
  /** False for the "alternate" PN of a bucket (PN-10 of PN-10/16, PN-20/30 of PN-25). */
  pnExact: boolean;
  inStock: boolean;
}

interface ItemConfig {
  valveType: string;
  /** Required L4, or null to leave L4 unconstrained. */
  component: string | null;
  /** L6 must match this (NRV is swing type only). */
  stdPattern?: RegExp;
  /** Match on size alone: TPAV is one model for every PN / variant. */
  commonModel?: boolean;
  /** Skip the DI-vs-CS filter (air cushion masters are CS / MS only). */
  anyMaterial?: boolean;
  /** Allow CLASS 150# codes for a PN-16 indent. */
  allowClass150?: boolean;
  /** Ranking hint: lower is better. */
  prefer?: (row: PreparedRm) => number;
  /** TPAV rows also get the isolating sluice valve appended. */
  isolatingSlv?: boolean;
}

const SLV_CONFIG: ItemConfig = {
  valveType: RM_CODE_VALVE_TYPE,
  component: "METAL TO RUBBER",
};

export const RM_CODE_CONFIG_BY_ITEM: Record<string, ItemConfig> = {
  SLV: SLV_CONFIG,
  "SLV METAL": { valveType: RM_CODE_VALVE_TYPE, component: "METAL TO METAL" },
  NRV: {
    valveType: RM_CODE_CHECK_VALVE_TYPE,
    component: null,
    stdPattern: /^SWING TYPE/,
  },
  BFV: {
    valveType: "BUTTERFLY VALVE",
    component: null,
    prefer: (r) => (r.component === "BLANK BASE" ? 0 : 1),
  },
  DPCV: {
    valveType: "DPCV",
    component: null,
    prefer: (r) => (r.component === "METAL TO RUBBER" ? 0 : 1),
  },
  PRV: {
    valveType: "PRESSURE REDUCING VALVE",
    component: null,
    prefer: (r) => (r.stdNorm.startsWith("CONTROL DIAPHRAGM") ? 0 : 1),
  },
  TPAV: {
    valveType: "TPAV",
    component: null,
    commonModel: true,
    isolatingSlv: true,
  },
  "TPAV+SLV": {
    valveType: "TPAV",
    component: null,
    commonModel: true,
    isolatingSlv: true,
  },
  "AIR CUSHION": {
    valveType: "AIR CUSHION VALVE",
    component: null,
    anyMaterial: true,
    allowClass150: true,
  },
  "SLUICE GATE": { valveType: "SLUICE GATE", component: null },
};

/** Indent items the resolver handles (the Indent Listing table reads the keys). */
export const RM_CODE_MATCH_BY_ITEM = RM_CODE_CONFIG_BY_ITEM;

/** TPAV 20 / 25 mm run on the small-orifice master (RZR030019, 12.5MM). */
const TPAV_SMALL_ORIFICE_SIZES = new Set(["20", "25"]);
const TPAV_SMALL_ORIFICE_KEY = "12.5";

/** BFV sizes that are GMD production (FG code, not a trading RM code). */
const BFV_PRODUCTION_SIZES = new Set(["700", "800"]);

/** L4 values that are spares / BIS samples, never the indent item. */
const EXCLUDED_COMPONENT = /\b(?:SAMPLE FOR BIS|BONNET|DISC|COVER)\b/;

/** Category a blank slot falls back to; null = the item has no such variant. */
const DEFAULT_CATEGORY_BY_SLOT = ["Base", "9523", "Rising", "Rising 9523"];
const NRV_DEFAULT_CATEGORY_BY_SLOT = ["Base", "9523", null, null];

export interface RawMaterialMatchRow {
  erpItemCode: string | null;
  itemNameAuto?: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l7Dimension: string | null;
  l8ItemCategory: string | null;
  availableStock?: string | null;
}

export interface IndentRmCodeInput {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
  v4: string | null;
  v1Category: string | null;
  v2Category: string | null;
  v3Category: string | null;
  v4Category: string | null;
}

export interface IndentRmCodeUpdate {
  id: string;
  rmCodeV1: string;
  rmCodeV2: string;
  rmCodeV3: string;
  rmCodeV4: string;
}

export interface IndentRmCodePlan {
  updates: IndentRmCodeUpdate[];
  /** Populated V slots (per category) that had exactly one candidate. */
  resolved: number;
  /** Populated V slots that had several candidates (the best one was picked). */
  ambiguous: number;
  /** Populated V slots with no live raw material at all. */
  unmatched: number;
}

interface Attrs {
  cs: boolean;
  rising: boolean;
  nine: boolean;
  wafer: boolean;
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** "200MM", "200 mm" and "200" all collapse to "200". */
export function rmCodeSizeKey(value: string | null | undefined): string {
  return normalizeKeyPart(value).replace(/\s*(?:MM|IN|INCH)$/, "");
}

/** Hyphen/space/slash separators collapse, so "NON-RISING-9523" == "Non Rising 9523". */
function normalizeStd(value: unknown): string {
  return normalizeKeyPart(value).replace(/[-\/]+/g, " ");
}

function isTradingValve(value: string | null | undefined): boolean {
  return normalizeKeyPart(value).includes(RM_CODE_ITEM_CATEGORY);
}

/**
 * The L5- MATERIAL a slot requires, derived from its stored category. Only a
 * "CS" category constrains the material to carbon steel; null means "not CS".
 */
export function rmCodeRequiredMaterial(
  category: string | null | undefined,
): string | null {
  const raw = String(category ?? "").trim();
  if (!raw) return null;
  return /\bCS\b/.test(raw.toUpperCase()) ? RM_CODE_CARBON_STEEL : null;
}

function parseToken(token: string): Attrs {
  const t = token.toUpperCase();
  return {
    cs: /\bCS\b/.test(t),
    rising: t.includes("RISING"),
    nine: t.includes("9523"),
    wafer: t.includes("WAFER"),
  };
}

/** One Attrs per comma-separated category ("Rising, Rising CS" -> two). */
function parseCategory(
  category: string | null,
  fallback: string | null,
): Attrs[] {
  const text = String(category ?? "").trim() || fallback;
  if (!text) return [];
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map(parseToken);
}

function prepare(rows: RawMaterialMatchRow[]): PreparedRm[] {
  const out: PreparedRm[] = [];
  for (const row of rows) {
    const code = (row.erpItemCode ?? "").trim();
    if (!code || !isTradingValve(row.l8ItemCategory)) continue;

    const valveType = normalizeKeyPart(row.l2ValveType);
    if (!RM_CODE_VALVE_TYPES.includes(valveType)) continue;

    const size = rmCodeSizeKey(row.l3Dia);
    const stdNorm = normalizeStd(row.l6Std);
    const pnBucket = pnRatingBucket(row.l7Dimension);
    if (!size || !stdNorm || !pnBucket) continue;

    const component = normalizeKeyPart(row.l4Component);
    // Sluice valves are told apart by L4; other types sometimes leave it blank
    // (TPAV 80), so only the sluice valve needs one.
    if (valveType === RM_CODE_VALVE_TYPE && !component) continue;
    if (EXCLUDED_COMPONENT.test(component)) continue;

    out.push({
      code,
      isTv: normalizeKeyPart(row.itemNameAuto).startsWith("TV-"),
      valveType,
      size,
      component,
      material: normalizeKeyPart(row.l5Material),
      stdNorm,
      rising: stdNorm.startsWith("RISING"),
      nine: stdNorm.includes("9523"),
      wafer: stdNorm.includes("WAFER"),
      pnBucket,
      pnExact: !/PN[\s-]*(?:10|20|30)(?!\d)/i.test(
        String(row.l7Dimension ?? ""),
      ),
      inStock: Number(row.availableStock) > 0,
    });
  }
  return out;
}

function compare(
  a: PreparedRm,
  b: PreparedRm,
  prefer: ((r: PreparedRm) => number) | undefined,
): number {
  return (
    Number(b.isTv) - Number(a.isTv) ||
    (prefer ? prefer(a) - prefer(b) : 0) ||
    Number(b.pnExact) - Number(a.pnExact) ||
    Number(b.inStock) - Number(a.inStock) ||
    a.code.localeCompare(b.code)
  );
}

interface Pick {
  code: string;
  candidates: number;
}

function pickCode(
  rows: PreparedRm[],
  config: ItemConfig,
  size: string,
  pnBucket: string,
  attrs: Attrs,
): Pick | null {
  const sizeKey =
    config.commonModel && TPAV_SMALL_ORIFICE_SIZES.has(size)
      ? TPAV_SMALL_ORIFICE_KEY
      : size;
  const component = config.component
    ? normalizeKeyPart(config.component)
    : null;
  const wantMaterial = attrs.cs ? RM_CODE_CARBON_STEEL : DUCTILE_IRON;

  const fits = rows.filter((r) => {
    if (r.valveType !== config.valveType || r.size !== sizeKey) return false;
    if (config.commonModel) return true;
    if (component && r.component !== component) return false;
    if (config.stdPattern && !config.stdPattern.test(r.stdNorm)) return false;
    if (
      r.rising !== attrs.rising ||
      r.nine !== attrs.nine ||
      r.wafer !== attrs.wafer
    ) {
      return false;
    }
    if (!config.anyMaterial && r.material !== wantMaterial) return false;
    return (
      r.pnBucket === pnBucket ||
      (config.allowClass150 &&
        pnBucket === "PN-10/16" &&
        r.pnBucket === "CLASS-150#")
    );
  });
  if (fits.length === 0) return null;
  fits.sort((a, b) => compare(a, b, config.prefer));
  return {
    code: fits[0].code,
    candidates: new Set(fits.map((r) => r.code)).size,
  };
}

/**
 * Resolves one RM code per populated V1..V4 slot (and per comma-separated
 * category inside it) for every item the resolver knows. Rows for any other
 * item (CF, DV, GV, blank) produce no update.
 *
 * `rawMaterials` must already be restricted to live rows by the caller; this
 * function never falls back to CLOSED history.
 */
export function planIndentRmCodes(
  indentRows: IndentRmCodeInput[],
  rawMaterials: RawMaterialMatchRow[],
): IndentRmCodePlan {
  const rows = prepare(rawMaterials);
  const updates: IndentRmCodeUpdate[] = [];
  let resolved = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const row of indentRows) {
    const itemKey = normalizeKeyPart(row.item);
    const config = RM_CODE_CONFIG_BY_ITEM[itemKey];
    if (!config) continue;

    const size = rmCodeSizeKey(row.size);
    const pnBucket = pnRatingBucket(row.pnRating);
    if (!size || !pnBucket) continue;

    const balances = [row.v1, row.v2, row.v3, row.v4];
    const categories = [
      row.v1Category,
      row.v2Category,
      row.v3Category,
      row.v4Category,
    ];
    const defaults =
      config.valveType === RM_CODE_CHECK_VALVE_TYPE
        ? NRV_DEFAULT_CATEGORY_BY_SLOT
        : DEFAULT_CATEGORY_BY_SLOT;
    const codes: string[] = [];

    for (let slot = 0; slot < 4; slot++) {
      if (String(balances[slot] ?? "").trim() === "") {
        codes.push("");
        continue;
      }

      const slotCodes: string[] = [];
      for (const attrs of parseCategory(categories[slot], defaults[slot])) {
        // GMD builds these in-house: the FG code applies, not a trading RM code.
        if (
          itemKey === "BFV" &&
          (attrs.cs || BFV_PRODUCTION_SIZES.has(size))
        ) {
          continue;
        }

        const parts: Pick[] = [];
        const main = pickCode(rows, config, size, pnBucket, attrs);
        if (main) parts.push(main);
        if (config.isolatingSlv) {
          const iso = pickCode(rows, SLV_CONFIG, size, pnBucket, attrs);
          if (iso) parts.push(iso);
        }

        if (parts.length === 0) {
          unmatched++;
          continue;
        }
        if (parts.every((p) => p.candidates === 1)) resolved++;
        else ambiguous++;
        for (const p of parts) {
          if (!slotCodes.includes(p.code)) slotCodes.push(p.code);
        }
      }
      codes.push(slotCodes.join(", "));
    }

    updates.push({
      id: row.id,
      rmCodeV1: codes[0],
      rmCodeV2: codes[1],
      rmCodeV3: codes[2],
      rmCodeV4: codes[3],
    });
  }

  return { updates, resolved, ambiguous, unmatched };
}

export type RmCodeSlotKey =
  | "rmCodeV1"
  | "rmCodeV2"
  | "rmCodeV3"
  | "rmCodeV4";

const RM_CODE_SLOT_KEYS: readonly RmCodeSlotKey[] = [
  "rmCodeV1",
  "rmCodeV2",
  "rmCodeV3",
  "rmCodeV4",
];

export interface RmCodeWrite {
  id: string;
  rmCodeV1?: string;
  rmCodeV2?: string;
  rmCodeV3?: string;
  rmCodeV4?: string;
}

/**
 * Narrows planned RM-code updates to the slots that need a write: a slot is
 * written only when the plan is non-blank AND the stored value is blank, so
 * curated / hand-picked codes are never overwritten. Rows with no qualifying
 * slot are dropped.
 */
export function planRmCodeWrites(
  planned: IndentRmCodeUpdate[],
  currentById: ReadonlyMap<
    string,
    { rmCodeV1: string | null; rmCodeV2: string | null; rmCodeV3: string | null; rmCodeV4: string | null }
  >,
): RmCodeWrite[] {
  const writes: RmCodeWrite[] = [];
  for (const update of planned) {
    const current = currentById.get(update.id);
    if (!current) continue;

    const write: RmCodeWrite = { id: update.id };
    let changed = false;
    for (const key of RM_CODE_SLOT_KEYS) {
      const next = update[key];
      if (next.trim() === "") continue;
      // Curated codes are never overwritten: only blank slots are filled.
      if (String(current[key] ?? "").trim() !== "") continue;
      write[key] = next;
      changed = true;
    }
    if (changed) writes.push(write);
  }
  return writes;
}
