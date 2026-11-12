import { NEW_BOM_PREFIX } from "./autoBom";

export type LinkedBomItem = {
  id: string;
  key: string; // (bom, component) key, same shape as the sync's desired keys
  bomCode: string; // Bom.bomId
  manualLink: boolean;
};

// BomItem ids the BOM MAST sync should unlink: links the sheet does not back,
// including every link of a BOM the sheet no longer lists. Hand-picked links
// (Raw Material "BOM ID" dropdown) and auto-BOM drafts are kept.
export function staleBomItemIds(
  items: LinkedBomItem[],
  desiredKeys: Set<string>,
): string[] {
  return items
    .filter(
      (i) =>
        !i.manualLink &&
        !i.bomCode.startsWith(NEW_BOM_PREFIX) &&
        !desiredKeys.has(i.key),
    )
    .map((i) => i.id);
}

// The erpQty an existing link should get from the sheet's QTYUNIT, or undefined
// to leave it alone. `sheetQty` undefined = the tab has no QTYUNIT column, so a
// renamed or dropped column never wipes the stored quantities.
export function erpQtyUpdate(
  stored: unknown,
  sheetQty: number | null | undefined,
): number | null | undefined {
  if (sheetQty === undefined) return undefined;
  return (stored == null ? null : Number(stored)) === sheetQty ? undefined : sheetQty;
}
