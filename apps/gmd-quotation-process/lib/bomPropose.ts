import { extractExtensionFromItemName } from "@/lib/extensionMatcher";

/**
 * Nearest-BOM pick for auto-proposed BOMs (pure). The template is the open,
 * approved BOM of the item that matches the target on the most attributes;
 * valve type and size must both match or nothing is proposed.
 */
export interface ItemAttrs {
  itemCode: string;
  itemName?: string | null;
  itemType?: string | null;
  size?: string | null;
  moc?: string | null;
  pnGmd?: string | null;
  operation?: string | null;
}

const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
const same = (a: unknown, b: unknown) => !!up(a) && up(a) === up(b);

export function similarity(a: ItemAttrs, b: ItemAttrs): number {
  let s = 0;
  if (same(a.itemType, b.itemType)) s += 4;
  if (same(a.size, b.size)) s += 4;
  if (same(a.moc, b.moc)) s += 2;
  if (same(a.pnGmd, b.pnGmd)) s += 1;
  if (same(a.operation, b.operation)) s += 1;
  const ea = a.itemName ? extractExtensionFromItemName(a.itemName) : null;
  const eb = b.itemName ? extractExtensionFromItemName(b.itemName) : null;
  if (ea && ea === eb) s += 1;
  return s;
}

/** Best candidate among those matching on valve type AND size; first wins on ties. */
export function pickNearest<T extends ItemAttrs>(target: ItemAttrs, candidates: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (c.itemCode === target.itemCode) continue;
    if (!same(target.itemType, c.itemType) || !same(target.size, c.size)) continue;
    const s = similarity(target, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
