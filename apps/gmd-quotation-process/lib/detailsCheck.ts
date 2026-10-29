import { allowedSizes } from "./sizeExtractor";
import { matchPnRating } from "./pnRatingMatcher";

/** The five Details fields a docket item needs before an item code can be fetched. */
export const DETAILS_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType"] as const;
export type DetailsField = (typeof DETAILS_FIELDS)[number];

// Keep in step with SIZE_BLANK_VALUES in lib/enquiry-query.ts.
const EMPTY_VALUES = new Set(["", "unknown", "not detectable", "not mentioned/cant detect size"]);

export function isEmptyDetail(value: string | null | undefined): boolean {
  return EMPTY_VALUES.has((value ?? "").trim().toLowerCase());
}

export function missingDetails(item: Partial<Record<DetailsField, string | null>>): DetailsField[] {
  return DETAILS_FIELDS.filter((f) => isEmptyDetail(item[f]));
}

/**
 * Size stated explicitly in the item name ("150 mm dia", "DN 200", "250 NB").
 * Stricter than extractSizeFromItemName: no bare numbers, no inch/rounding guesses,
 * so it is safe to use for flagging a mismatch.
 */
export function sizeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const patterns = [
    /(\d+)\s*mm\s*(?:dia|diameter|nb|n\.b)\b/i,
    /\bdia(?:meter)?\.?\s*(\d+)\s*(?:mm)?/i,
    /\bDN\s*(\d+)/i,
    /(\d+)\s*DN\b/i,
    /\bNB\s*(\d+)/i,
    /(\d+)\s*NB\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(name);
    if (m && allowedSizes.includes(m[1])) return m[1];
  }
  return null;
}

/** PN from the item name: PN text via the shared matcher, plus "16 kg/cm²" style pressure. */
export function pnFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const matched = matchPnRating(name);
  if (matched) return matched;
  // shortcut: only 10/16 kg/cm² map to PN-10/16, other pressures need a rating table.
  const kg = /\b(10|16)(?:\.0)?\s*kg\s*\/?\s*(?:sq\.?\s*cm|cm\s*[²2])/i.exec(name);
  return kg ? "PN-10/16" : null;
}

/** One proposed Auto-Fill edit, shown for Accept/Reject before anything is saved. */
export interface AutoFillChange {
  itemId: string;
  itemName: string;
  field: "itemType" | "moc" | "size" | "pnRating" | "operationType" | "extension" | "bypass";
  oldValue: string;
  newValue: string;
  /** Set for itemType/moc: where the value came from (keyword/ai), saved to <field>Source. */
  source?: string | null;
  /** Derived from a hint in the item name, not a lookup: the user should double-check it. */
  verify?: boolean;
}
