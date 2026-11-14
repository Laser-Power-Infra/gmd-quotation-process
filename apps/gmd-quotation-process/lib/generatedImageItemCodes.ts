import { prisma } from "@/lib/prisma";
import { makeImageKey } from "./imageKey";

type ItemRow = {
  itemType: string | null;
  operationType: string | null;
  rmType: string | null;
  erpItemCode: string | null;
};

/** Distinct, sorted ERP item codes per image key (itemType + operationType + rmType). */
export function groupItemCodesByImageKey(rows: ItemRow[]): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = r.erpItemCode?.trim();
    const itemType = r.itemType?.trim();
    const operationType = r.operationType?.trim();
    if (!code || !itemType || !operationType) continue;
    const key = makeImageKey(itemType, operationType, r.rmType?.trim() ?? "");
    let set = sets.get(key);
    if (!set) sets.set(key, (set = new Set()));
    set.add(code);
  }
  return new Map([...sets].map(([k, s]) => [k, [...s].sort()]));
}

/**
 * Rewrite GeneratedImage.itemCodes from the current enquiry items. Only rows
 * whose list actually changed are written.
 */
// shortcut: runs after image uploads and item-code master syncs only, so an
// item edited in between shows its old code here until the next run. Call this
// from the item-code write paths if that lag ever matters.
export async function syncGeneratedImageItemCodes(): Promise<{ updated: number }> {
  const [items, images] = await Promise.all([
    prisma.enquiryItem.findMany({
      where: { erpItemCode: { not: null }, itemType: { not: null }, operationType: { not: null } },
      select: { itemType: true, operationType: true, rmType: true, erpItemCode: true },
    }),
    prisma.generatedImage.findMany({ select: { id: true, imageKey: true, itemCodes: true } }),
  ]);
  const byKey = groupItemCodesByImageKey(items);

  let updated = 0;
  for (const img of images) {
    const next = byKey.get(img.imageKey) ?? [];
    if (next.join("|") === img.itemCodes.join("|")) continue;
    await prisma.generatedImage.update({ where: { id: img.id }, data: { itemCodes: next } });
    updated++;
  }
  return { updated };
}
