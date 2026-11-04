/**
 * Logic-based BOM TYPE for the /bom page. Counts the OPEN lines (noUse blank)
 * of a BOM and looks at what the single child is for 1:1 BOMs.
 */

export interface BomLine {
  code: string;
  name?: string | null;
  /** Child is another FullItem (FG code), not a RawMaterial. */
  isFullItem: boolean;
  /** noUse blank (TO_DATE not set in BOM MAST ERP). */
  open: boolean;
}

export const BOM_TYPE = {
  m2m: "M2M / Trading valve",
  fgSubstitute: "FG -> FG substitute",
  otherRm: "1:1 other RM (review)",
  twoToOne: "2:1",
  threeToOne: "3:1",
  production: "Create BOM / Production item",
  closed: "Closed",
  empty: "Unclassified (review)",
} as const;
export type BomType = (typeof BOM_TYPE)[keyof typeof BOM_TYPE];

const isTradingCode = (l: BomLine) =>
  /^TV-/i.test(l.code.trim()) || /^TV-/i.test(String(l.name ?? "").trim());

export function classifyBom(lines: BomLine[]): BomType {
  if (lines.length === 0) return BOM_TYPE.empty;
  const open = lines.filter((l) => l.open);
  if (open.length === 0) return BOM_TYPE.closed;
  if (open.length === 1) {
    const [c] = open;
    if (c.isFullItem) return BOM_TYPE.fgSubstitute;
    if (isTradingCode(c)) return BOM_TYPE.m2m;
    return BOM_TYPE.otherRm;
  }
  if (open.length === 2) return BOM_TYPE.twoToOne;
  if (open.length === 3) return BOM_TYPE.threeToOne;
  return BOM_TYPE.production;
}

/** Stored Bom.bomIdType values that agree with a classified type. */
const STORED_FOR_TYPE: Record<string, string[]> = {
  [BOM_TYPE.m2m]: ["DIRECT M2M", "M2M"],
  [BOM_TYPE.fgSubstitute]: ["DIRECT M2M", "M2M"],
  [BOM_TYPE.twoToOne]: ["2:1"],
  [BOM_TYPE.threeToOne]: ["3:1"],
  [BOM_TYPE.production]: ["CREATE BOM"],
};

/** True when a stored BOM ID TYPE exists and contradicts the classified type. */
export function storedTypeDisagrees(type: BomType, stored: string | null | undefined): boolean {
  const s = String(stored ?? "").trim().toUpperCase();
  if (!s) return false;
  const ok = STORED_FOR_TYPE[type];
  return ok ? !ok.includes(s) : false;
}
