import { extractSizeFromItemName } from "@/lib/sizeExtractor";
import { matchItemType } from "@/lib/itemTypePatterns";
import { matchPnRating } from "@/lib/pnRatingMatcher";

/**
 * Parent vs child checks for BOM lines where the child stands in for the whole
 * valve (an FG code or a TV- trading code). Returns human-readable issues.
 * MOC substitutions inside the iron family (CI <-> DI) are allowed and reported
 * as info with the "MOC subst" prefix, so callers can keep them off the red flag.
 */

export interface BomSide {
  name?: string | null;
  size?: string | null;
  moc?: string | null;
  pn?: string | null;
}

export const MOC_SUBST_PREFIX = "MOC subst";

const up = (v: unknown) => String(v ?? "").trim().toUpperCase();

/** "900MM", "900", "36\"", "DN900" -> "900"; null when nothing parses. */
export function normalizeSize(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return String(parseFloat(s));
  const dn = /^DN\s*(\d+)$/i.exec(s);
  if (dn) return dn[1];
  return extractSizeFromItemName(s);
}

const IRON_FAMILY: Record<string, string> = {
  CI: "CI", "CAST IRON": "CI", DI: "DI", "DUCTILE IRON": "DI", "D.I": "DI", "C.I": "CI",
  "DUCTILE IRON/CAST IRON": "CI/DI", "CI/DI": "CI/DI", "CI / DI": "CI/DI",
};

export function normalizeMoc(v: unknown): string | null {
  const s = up(v).replace(/\.$/, "");
  if (!s) return null;
  return IRON_FAMILY[s] ?? s;
}

export function bomMismatches(parent: BomSide, child: BomSide): string[] {
  const issues: string[] = [];

  const pSize = normalizeSize(parent.size) ?? extractSizeFromItemName(parent.name);
  const cSize = normalizeSize(child.size) ?? extractSizeFromItemName(child.name);
  if (pSize && cSize && pSize !== cSize) issues.push(`Size ${pSize} vs ${cSize}`);

  const pMoc = normalizeMoc(parent.moc);
  const cMoc = normalizeMoc(child.moc);
  if (pMoc && cMoc && pMoc !== cMoc) {
    const iron = (m: string) => m === "CI" || m === "DI" || m === "CI/DI";
    issues.push(iron(pMoc) && iron(cMoc) ? `${MOC_SUBST_PREFIX} ${pMoc}->${cMoc}` : `MOC ${pMoc} vs ${cMoc}`);
  }

  const pPn = matchPnRating(parent.pn) ?? matchPnRating(parent.name);
  const cPn = matchPnRating(child.pn) ?? matchPnRating(child.name);
  if (pPn && cPn && pPn !== cPn) issues.push(`PN ${pPn} vs ${cPn}`);

  const pType = matchItemType(parent.name);
  const cType = matchItemType(child.name);
  if (pType && cType && pType !== cType) issues.push(`Type ${pType} vs ${cType}`);

  return issues;
}

/** Issues that make a BOM wrong (everything except an allowed MOC substitution). */
export const isHardIssue = (issue: string) => !issue.startsWith(MOC_SUBST_PREFIX);
