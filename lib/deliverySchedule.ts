import { prisma } from "@/lib/prisma";

export const DEFAULT_DELIVERY_SCHEDULE = "2-3 weeks";

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Computes the delivery schedule for an enquiry item.
 * Returns "2-3 weeks" when both quantity and availableStock are present
 * and availableStock >= quantity; otherwise returns null (meaning "no change").
 */
export function computeDeliverySchedule(
  quantity: unknown,
  availableStock: unknown
): string | null {
  const qty = toNumber(quantity);
  const stock = toNumber(availableStock);
  if (qty === null || stock === null) return null;
  if (stock >= qty) return DEFAULT_DELIVERY_SCHEDULE;
  return null;
}

/**
 * Reads the item, computes its delivery schedule from quantity vs availableStock,
 * and persists it only when the computed value differs from the stored one.
 * Never clears an existing value.
 */
export async function syncDeliveryScheduleForItem(itemId: string): Promise<string | null> {
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: { id: true, quantity: true, availableStock: true, deliverySchedule: true },
  });
  if (!item) return null;

  const next = computeDeliverySchedule(item.quantity, item.availableStock);
  if (next === null || next === item.deliverySchedule) {
    return item.deliverySchedule;
  }

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: { deliverySchedule: next },
  });
  return next;
}