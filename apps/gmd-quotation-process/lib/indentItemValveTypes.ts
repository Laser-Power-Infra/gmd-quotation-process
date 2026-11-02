/**
 * Indent item -> the L2-VALVE TYPE values its RM codes may come from (Puja's
 * mapping rules, 30 Oct). Shared by the Recompute resolver and the RM CODE
 * dropdown so a wrong-type pick (e.g. a sluice code on a BFV) is impossible.
 *
 * TPAV with isolation counts in both TPAV and SLV, so it allows both types.
 * Items missing here (CF, DV, blank) have no type in the master yet.
 */
export const VALVE_TYPES_BY_INDENT_ITEM: Record<string, readonly string[]> = {
  SLV: ["SLUICE VALVE"],
  "SLV METAL": ["SLUICE VALVE"],
  GV: ["SLUICE VALVE"],
  TPAV: ["TPAV", "SLUICE VALVE"],
  "TPAV+SLV": ["TPAV", "SLUICE VALVE"],
  NRV: ["CHECK VALVE"],
  BFV: ["BUTTERFLY VALVE"],
  DPCV: ["DPCV"],
  PRV: ["PRESSURE REDUCING VALVE"],
  "AIR CUSHION": ["AIR CUSHION VALVE"],
  "SLUICE GATE": ["SLUICE GATE"],
};

export function valveTypesForIndentItem(item: string | null | undefined): readonly string[] {
  const key = String(item ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return VALVE_TYPES_BY_INDENT_ITEM[key] ?? [];
}
