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
