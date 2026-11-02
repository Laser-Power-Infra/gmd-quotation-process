"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { listHeatSerials } from "@gmd/physical-stock/server";
import { normaliseValveSerial, pickStandard } from "@/lib/valveSerial";
import type { ValveSerialView, ValveStandard } from "@/lib/valveSerial";
import type { Prisma } from "@gmd/db-quotation";

export type ValveSerialRecord = ValveSerialView & { id: string; standard: ValveStandard | null; assignedBy: string | null; updatedAt: Date };

async function lookupStandard(input: Partial<ValveSerialView>): Promise<ValveStandard> {
  const [flangeRows, gateRows] = await Promise.all([
    prisma.flange.findMany({ orderBy: { rowIndex: "asc" } }),
    prisma.gateValve.findMany({ orderBy: { rowIndex: "asc" } }),
  ]);
  return pickStandard(input, flangeRows, gateRows);
}

export async function listValveSerialsAction(): Promise<ValveSerialRecord[]> {
  await requireAccess();
  const rows = await prisma.valveSerial.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({ ...r, standard: (r.standard as ValveStandard | null) ?? null }));
}

/** Standard values for the pre-fill button. */
export async function valveStandardAction(input: Partial<ValveSerialView>) {
  await requireAccess();
  return lookupStandard(input);
}

/** Pickers: serials assigned on the heat-entry form, and the Flange tab's sizes and PN ratings. */
export async function valveSerialOptionsAction() {
  await requireAccess();
  const [serials, options] = await Promise.all([
    listHeatSerials(),
    prisma.flange.findMany({ select: { size: true, pnRatingClass: true } }),
  ]);
  const uniq = (vs: (string | null)[]) => [...new Set(vs.filter((v): v is string => !!v?.trim()))];
  return { serials, sizes: uniq(options.map((o) => o.size)), pnRatings: uniq(options.map((o) => o.pnRatingClass)) };
}

/**
 * Creates or updates a serial-no record. The standard snapshot is taken on create and
 * re-taken only when type, size or PN change, so a sheet re-sync cannot move a flag.
 */
export async function saveValveSerialAction(id: string | null, input: Partial<ValveSerialView>): Promise<{ success: boolean; error?: string }> {
  await requireAccess();
  const denied = await loginRequired();
  if (denied) return denied;
  const r = normaliseValveSerial(input);
  if ("error" in r) return { success: false, error: r.error };
  try {
    const { auth } = await import("@/auth");
    const user = (await auth())?.user;
    const assignedBy = user?.name ?? user?.email ?? null;
    const existing = id ? await prisma.valveSerial.findUnique({ where: { id } }) : null;
    if (id && !existing) return { success: false, error: "Serial no record not found." };
    const restandard =
      !existing ||
      existing.valveType !== r.data.valveType ||
      existing.sizeDn !== r.data.sizeDn ||
      existing.pnRating !== r.data.pnRating;
    const standard = restandard ? ((await lookupStandard(r.data)) as Prisma.InputJsonValue) : undefined;
    // shortcut: matches the typed serial against every heat serial, fine for thousands; index the built serial if it grows past that.
    const heatEntryId = (await listHeatSerials()).find((h) => h.serial_no === r.data.serialNo)?.id ?? null;
    if (existing) {
      await prisma.valveSerial.update({ where: { id: existing.id }, data: { ...r.data, heatEntryId, ...(standard && { standard }) } });
    } else {
      await prisma.valveSerial.create({ data: { ...r.data, heatEntryId, standard, assignedBy } });
    }
    return { success: true };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { success: false, error: `Serial No ${r.data.serialNo} is already assigned.` };
    console.error("saveValveSerialAction", e);
    return { success: false, error: "Could not save the serial no." };
  }
}
