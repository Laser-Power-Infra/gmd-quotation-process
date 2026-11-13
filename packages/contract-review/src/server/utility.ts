// The standard utility list for every dashboard: the active UTILITY LookupOption
// rows in the quotation DB. No "server-only" import: the quotation app's tsx
// scripts (remap-utilities) load this too.
import { prisma } from "@gmd/db-quotation";
import { lookupUtilityResolver, type UtilityResolver } from "../lib/utilityMaster";

const ACTIVE_UTILITIES = { type: "UTILITY", isActive: true };

/** Utility dropdown options, A→Z. */
export async function getUtilityOptions(): Promise<string[]> {
  const rows = await prisma.lookupOption.findMany({ where: ACTIVE_UTILITIES, select: { value: true } });
  return rows.map((r) => r.value).sort((a, b) => a.localeCompare(b));
}

/**
 * Maps any utility text to its LookupOption value (see standardUtility). Throws when
 * the quotation DB is unreachable or has no active UTILITY rows, so a wrong or
 * unseeded DB never lets a sync write raw text.
 */
export async function loadUtilityResolver(): Promise<UtilityResolver> {
  const rows = await prisma.lookupOption.findMany({ where: ACTIVE_UTILITIES, select: { value: true, code: true } });
  if (rows.length === 0) {
    throw new Error("No active UTILITY LookupOption rows: wrong quotation database, or the utility list is not seeded.");
  }
  return lookupUtilityResolver(rows);
}
