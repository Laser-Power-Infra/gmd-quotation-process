/** Apply matched China lots through an injected add function. Pure of I/O so it can be tested with mocks. */
import type { SheetRow } from "./chinaLotMatch";

export interface Matched { row: SheetRow; poNo: string; poLineNo: string }
export interface ExistingAlloc { poNo: string; poLineNo: string; contractNo: string; itemCode: string; qty: number }
export interface LoadResult { loaded: number; alreadyLoaded: number; conflicts: string[]; failed: string[] }

const key = (poNo: string, poLineNo: string, c: string, i: string) => `${poNo}|${poLineNo}|${c.trim().toUpperCase()}|${i.trim().toUpperCase()}`;

/**
 * Same key + same qty already booked = "already loaded". Same key, different qty (a second lot on the same PO line,
 * contract and item, or a changed sheet) = conflict, reported and never dropped or merged. `isDuplicate` recognises the
 * ledger's typed duplicate error (a race with another writer), which also counts as already loaded.
 */
export async function applyLots(
  matched: Matched[], existing: ExistingAlloc[],
  add: (m: Matched) => Promise<unknown>, isDuplicate: (e: unknown) => boolean,
): Promise<LoadResult> {
  const seen = new Map(existing.map((a) => [key(a.poNo, a.poLineNo, a.contractNo, a.itemCode), a.qty]));
  const res: LoadResult = { loaded: 0, alreadyLoaded: 0, conflicts: [], failed: [] };
  for (const m of matched) {
    const { row: r, poNo, poLineNo } = m;
    const label = `${r.contractNo} ${r.itemCode} ${poNo}/${poLineNo}`;
    const k = key(poNo, poLineNo, r.contractNo, r.itemCode);
    const have = seen.get(k);
    if (have !== undefined) {
      if (have === r.qty) res.alreadyLoaded++;
      else res.conflicts.push(`${label}: sheet lot ${r.lot} qty ${r.qty} but ${have} is already booked on this key, not loaded`);
      continue;
    }
    try { await add(m); seen.set(k, r.qty); res.loaded++; }
    catch (e) {
      if (isDuplicate(e)) res.alreadyLoaded++;
      else res.failed.push(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return res;
}
