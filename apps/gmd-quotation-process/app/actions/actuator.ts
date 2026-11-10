"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { applyActuatorToItem, type ActuatorPatch } from "@/lib/actuatorItem";
import { latestOffer } from "@/lib/actuatorCost";

/** "Fetch Actuator": fill act/gb codes from MAPPING and price each actuated item from the masters. */
export async function fetchActuatorAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  const items: NonNullable<Awaited<ReturnType<typeof applyActuatorToItem>>["item"]>[] = [];
  const notes: { itemId: string; note: string }[] = [];
  let pending = 0;
  for (const id of itemIds) {
    try {
      const r = await applyActuatorToItem(id);
      if (r.item) { items.push(r.item); if (r.pending) pending++; if (r.reason) notes.push({ itemId: id, note: r.reason }); }
    } catch (e) {
      notes.push({ itemId: id, note: e instanceof Error ? e.message : "Failed" });
    }
  }
  return { success: true as const, data: { items, pending, notes } };
}

/** Edit dialog save: make / control type / codes / adaptor / assembly, then re-price. */
export async function saveActuatorFieldsAction(itemId: string, patch: ActuatorPatch) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  const r = await applyActuatorToItem(itemId, patch);
  return r.item ? { success: true as const, data: { items: [r.item] } } : { success: false as const, error: r.skipped ?? "Not saved" };
}

/** Record a new AUMA/Rotork offer for an ACT CODE; an older offer never replaces a newer one. */
export async function recordActuatorOfferAction(actCode: string, price: number, offerDate: string, validTill: string | null) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  const row = await prisma.actuatorMaster.findUnique({ where: { actCode } });
  if (!row) return { success: false as const, error: `Unknown ACT CODE ${actCode}` };
  const date = new Date(offerDate);
  if (Number.isNaN(date.getTime()) || !(price > 0)) return { success: false as const, error: "Need a price above 0 and a valid offer date." };
  if (!latestOffer(row.offerDate, date)) return { success: false as const, error: "A newer offer is already recorded for this code." };
  await prisma.actuatorMaster.update({ where: { actCode }, data: { price, offerDate: date, offerValidTill: validTill ? new Date(validTill) : null } });
  return { success: true as const };
}
