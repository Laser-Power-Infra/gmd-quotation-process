"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { listHeatSerials } from "@gmd/physical-stock/server";
import type { HeatSerial } from "@gmd/physical-stock/types";
import { listValveSerialFacet, listValveSerialPage } from "@gmd/valve-serial/server";
import { needsStandard, normaliseValveSerial, pickStandard } from "@gmd/valve-serial/fields";
import type { ValveSerialView, ValveStandard } from "@gmd/valve-serial/fields";
import type { ValveSerialPageData } from "@gmd/valve-serial/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import type { Prisma } from "@gmd/db-quotation";

// Valve serials live in the quotation DB (@gmd/valve-serial); heat-entry serials
// and their stock rows live in the stock DB, so they are joined here.

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (err: unknown): Result<never> => ({ success: false, error: err instanceof Error ? err.message : String(err) });

async function lookupStandard(input: Partial<ValveSerialView>): Promise<ValveStandard> {
  const [flangeRows, gateRows] = await Promise.all([
    prisma.flange.findMany({ orderBy: { rowIndex: "asc" } }),
    prisma.gateValve.findMany({ orderBy: { rowIndex: "asc" } }),
  ]);
  return pickStandard(input, flangeRows, gateRows);
}

/** One filtered/sorted page; serials from the heat-entry form get their stock row's ERP code, location and available qty. */
export async function loadPage(query: TableQuery): Promise<Result<ValveSerialPageData>> {
  try {
    await requireAccess();
    const page = await listValveSerialPage(query);
    const ids = page.rows.flatMap((r) => (r.heatEntryId ? [r.heatEntryId] : []));
    let stock = new Map<string, HeatSerial>();
    try {
      if (ids.length) stock = new Map((await listHeatSerials(ids)).map((h) => [h.id, h]));
    } catch (err) {
      console.error("[valve-serial] stock lookup failed", err); // the page still loads, stock columns blank
    }
    const rows = page.rows.map((r) => {
      const h = r.heatEntryId ? stock.get(r.heatEntryId) : undefined;
      return h ? { ...r, stockCode: h.erp_code, stockLocation: h.location, stockQty: h.available_qty } : r;
    });
    return { success: true, data: { ...page, rows } };
  } catch (err) {
    return failed(err);
  }
}

export async function loadFacet(key: string, query: TableQuery): Promise<Result<string[]>> {
  try {
    await requireAccess();
    return { success: true, data: await listValveSerialFacet(key, query) };
  } catch (err) {
    return failed(err);
  }
}

/** Standard values for the pre-fill button. */
export async function loadStandard(input: Partial<ValveSerialView>) {
  await requireAccess();
  return lookupStandard(input);
}

/** Pickers: serials assigned on the heat-entry form, and the Flange tab's sizes and PN ratings. */
export async function loadOptions() {
  await requireAccess();
  const [serials, options] = await Promise.all([
    listHeatSerials(),
    prisma.flange.findMany({ select: { size: true, pnRatingClass: true } }),
  ]);
  const uniq = (vs: (string | null)[]) => [...new Set(vs.filter((v): v is string => !!v?.trim()))];
  return { serials, sizes: uniq(options.map((o) => o.size)), pnRatings: uniq(options.map((o) => o.pnRatingClass)) };
}

/**
 * Creates or updates a serial-no record. The standard snapshot is taken on create (or when
 * the row has none yet or an empty one, e.g. imported from the dispatch sheet) and re-taken
 * only when type, size or PN change, so a sheet re-sync cannot move a flag (needsStandard).
 */
export async function saveSerial(id: string | null, input: Partial<ValveSerialView>): Promise<{ success: boolean; error?: string }> {
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
    const standard = needsStandard(existing, r.data) ? ((await lookupStandard(r.data)) as Prisma.InputJsonValue) : undefined;
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
    console.error("[valve-serial] save failed", e);
    return { success: false, error: "Could not save the serial no." };
  }
}
