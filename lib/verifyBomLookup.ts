import { prisma } from "@/lib/prisma";

export type VerifyBomCandidate = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  bomIdType: string | null;
  bomItemQty: string | null;
};

// Simple TTL cache for distinct bomIds per itemCode
let cache: Map<string, string[]> = new Map();
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

export function clearVerifyBomCache() {
  cache = new Map();
  cacheAt = 0;
}

export async function getDistinctBomIds(itemCode: string): Promise<string[]> {
  const now = Date.now();
  if (cache.has(itemCode) && now - cacheAt < CACHE_TTL_MS) {
    return cache.get(itemCode) ?? [];
  }
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode },
    select: { bomId: true },
    distinct: ["bomId"],
    orderBy: { bomId: "asc" },
  });
  const ids = rows.map((r) => r.bomId).filter(Boolean) as string[];
  // update cache
  cache.set(itemCode, ids);
  cacheAt = now;
  return ids;
}

export async function getCandidates(itemCode: string): Promise<VerifyBomCandidate[]> {
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode },
    orderBy: { bomId: "asc" },
  });
  return rows;
}

export async function getBatchDistinctBomIds(itemCodes: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(itemCodes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.verifyBom.findMany({
    where: { itemCode: { in: unique } },
    select: { itemCode: true, bomId: true },
    orderBy: [{ itemCode: "asc" }, { bomId: "asc" }],
  });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.itemCode || !r.bomId) continue;
    if (!map.has(r.itemCode)) map.set(r.itemCode, new Set());
    map.get(r.itemCode)!.add(r.bomId);
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of map) out.set(k, Array.from(set));
  // also ensure codes with 0 entries map to []
  for (const c of unique) if (!out.has(c)) out.set(c, []);
  return out;
}

export type BomUseStatus = "USE" | "NO USE" | null;

type BomRowShape = {
  itemCode: string | null;
  rmItemCode: string | null;
  bomIdType: string | null;
};

function computeBomUseStatus(rows: BomRowShape[]): BomUseStatus {
  if (rows.length === 0) return null;
  const types = new Set<string>();
  for (const r of rows) if (r.bomIdType) types.add(r.bomIdType);
  if (types.size !== 1) return null;
  const type = [...types][0];
  const minRms = type === "3:1" ? 3 : type === "2:1" ? 2 : null;
  if (minRms === null) return null;
  const items = new Set<string>();
  for (const r of rows) if (r.itemCode) items.add(r.itemCode);
  if (items.size !== 1) return null;
  const rms = new Set<string>();
  for (const r of rows) if (r.rmItemCode) rms.add(r.rmItemCode);
  return rms.size === minRms ? "USE" : "NO USE";  
}

export async function getBomUseStatus(bomId: string): Promise<BomUseStatus> {
  const rows = await prisma.verifyBom.findMany({
    where: { bomId },
    select: { itemCode: true, rmItemCode: true, bomIdType: true },
  });
  return computeBomUseStatus(rows);
}

export async function getBomUseStatusBatch(
  bomIds: string[],
): Promise<Map<string, BomUseStatus>> {
  const unique = [...new Set(bomIds.filter(Boolean))];
  const out = new Map<string, BomUseStatus>();
  if (unique.length === 0) return out;
  const rows = await prisma.verifyBom.findMany({
    where: { bomId: { in: unique } },
    select: { bomId: true, itemCode: true, rmItemCode: true, bomIdType: true },
  });
  const groups = new Map<string, BomRowShape[]>();
  for (const r of rows) {
    if (!r.bomId) continue;
    if (!groups.has(r.bomId)) groups.set(r.bomId, []);
    groups.get(r.bomId)!.push(r);
  }
  for (const id of unique) {
    out.set(id, computeBomUseStatus(groups.get(id) ?? []));
  }
  return out;
}

export async function populateAvailableBomIdsForItemId(itemId: string): Promise<string[]> {
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: { erpItemCode: true },
  });
  if (!item?.erpItemCode) {
    await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
    return [];
  }
  const ids = await getDistinctBomIds(item.erpItemCode);
  await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: ids } });
  return ids;
}

export async function refreshAvailableBomIdsForCodes(itemCodes: string[]): Promise<number> {
  const map = await getBatchDistinctBomIds(itemCodes);
  let updated = 0;
  for (const [code, ids] of map) {
    const res = await prisma.enquiryItem.updateMany({
      where: { erpItemCode: code },
      data: { availableBomIds: ids },
    });
    updated += res.count;
  }
  return updated;
}






