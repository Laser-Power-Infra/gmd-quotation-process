/** Columns the /api/bom route appends after BOM COST (shared with the /bom page). */
export const BOM_TYPE_HEADER = "BOM TYPE";
export const OPEN_BOMS_HEADER = "OPEN BOMS";
export const BOM_ISSUES_HEADER = "BOM ISSUES";
/** Hidden flag columns ("YES" or blank) behind the quick filters. */
export const MULTI_OPEN_BOM_HEADER = "MULTI OPEN BOM";
export const BOM_MISMATCH_HEADER = "BOM MISMATCH";
export const FLAG_YES = "YES";

export const BOM_EXTRA_HEADERS = [
  BOM_TYPE_HEADER,
  OPEN_BOMS_HEADER,
  BOM_ISSUES_HEADER,
  MULTI_OPEN_BOM_HEADER,
  BOM_MISMATCH_HEADER,
] as const;

export const BOM_CHANGE_KINDS = ["EDIT", "CLOSE", "REOPEN", "CREATE"] as const;
export type BomChangeKind = (typeof BOM_CHANGE_KINDS)[number];
export const BOM_CHANGE_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type BomChangeStatus = (typeof BOM_CHANGE_STATUSES)[number];

// A type alias (not an interface) so it is assignable to Prisma's InputJsonValue.
export type BomChangeLine = { code: string; qty: number };
