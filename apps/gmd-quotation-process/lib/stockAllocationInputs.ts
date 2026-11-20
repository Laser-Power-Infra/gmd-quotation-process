/**
 * What the Stock Allocation engine reads from the quotation DB for the live Contract Review lines: qty already
 * offered for inspection (MC register, INSPO_SO_QTY) and each line's major BOM parts (RM route). The package never
 * touches this DB, so the app passes `stockAllocationInputs` to computeStockAllocation and the page loaders.
 */
import { prisma } from "@/lib/prisma";
import type { AllocationInputs, ContractLine } from "@gmd/stock-allocation/types";

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const lineKey = (contractNo: string | null, itemCode: string | null) => `${norm(contractNo)}||${norm(itemCode)}`;

export type McOffered = { contractNo: string | null; itemCode: string | null; inspOfferedQty: number | null };
export type BomPart = {
  quantity: number | null; erpQty: unknown; noUse: string | null; bom: { bomId: string };
  rawMaterial: { erpItemCode: string | null; l2ValveType: string | null; l8ItemCategory: string | null } | null;
};

/** Pure: `stockAllocationInputs` loads the rows. */
export function buildStockAllocationInputs(lines: ContractLine[], mc: McOffered[], parts: BomPart[]): AllocationInputs {
  // shortcut: summed per contract + item code; an ERP contract with the item on two SL lines sums both while Contract Review's MC / billed qty may cover one. Join on contractSlNo if that shows up.
  const offeredBy = new Map<string, number>();
  for (const r of mc) offeredBy.set(lineKey(r.contractNo, r.itemCode), (offeredBy.get(lineKey(r.contractNo, r.itemCode)) ?? 0) + (r.inspOfferedQty ?? 0));
  const partsBy = new Map<string, { erpCode: string; qty: number }[]>();
  for (const p of parts) {
    const erpCode = norm(p.rawMaterial?.erpItemCode);
    // not parts of the valve: lines BOM MAST ERP closed (NO USE, as in the cost engine), and actuators / gearboxes,
    // whose availability shows on its own (rule h holds the line's approved actuator)
    const actOrGb = /ACTUATOR|GEAR ?BOX/.test(norm(`${p.rawMaterial?.l2ValveType ?? ""} ${p.rawMaterial?.l8ItemCategory ?? ""}`));
    if (!erpCode || norm(p.noUse) === "NO USE" || actOrGb) continue;
    const qty = Number(p.erpQty ?? p.quantity); // the ERP's fractional qty first, as in the cost engine
    // a major part with no qty still limits the build: one per valve
    partsBy.set(norm(p.bom.bomId), [...(partsBy.get(norm(p.bom.bomId)) ?? []), { erpCode, qty: qty > 0 ? qty : 1 }]);
  }
  const offered: Record<string, number> = {}, boms: Record<string, { erpCode: string; qty: number }[]> = {};
  for (const l of lines) {
    const o = offeredBy.get(lineKey(l.contractNo, l.itemCode));
    if (o !== undefined) offered[l.id] = o;
    const b = partsBy.get(norm(l.bomId));
    if (b) boms[l.id] = b;
  }
  // CHINA SHIPMENTS (GMD CLIENTS WISE) reader is a later task, blocked on the requester: no incoming until then.
  return { offered, boms, incoming: [] };
}

/** One query each for the lines' MC rows and their BOMs' major parts. */
export async function stockAllocationInputs(lines: ContractLine[]): Promise<AllocationInputs> {
  const contracts = [...new Set(lines.map((l) => l.contractNo.trim()).filter(Boolean))];
  const bomIds = [...new Set(lines.map((l) => (l.bomId ?? "").trim()).filter(Boolean))];
  const [mc, parts] = await Promise.all([
    prisma.mcRegisterLine.findMany({
      where: { contractNo: { in: contracts, mode: "insensitive" } },
      select: { contractNo: true, itemCode: true, inspOfferedQty: true },
    }),
    prisma.bomItem.findMany({
      // major = RawMaterial.majorMarking 'true', the same test as the BOM cost triggers
      where: { bom: { bomId: { in: bomIds, mode: "insensitive" } }, rawMaterial: { majorMarking: { equals: "true", mode: "insensitive" } } },
      select: {
        quantity: true, erpQty: true, noUse: true, bom: { select: { bomId: true } },
        rawMaterial: { select: { erpItemCode: true, l2ValveType: true, l8ItemCategory: true } },
      },
    }),
  ]);
  return buildStockAllocationInputs(lines, mc, parts);
}
