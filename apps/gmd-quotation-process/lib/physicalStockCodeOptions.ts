/**
 * Pure mapping behind the Physical Stock ERP-code picker snapshot (no Prisma, so it
 * is unit-testable). A CREATE BOM is owned by a finished-valve FullItem: its
 * itemType / size / pnGmd are the valve type / Dia / PN the stock New Item dialog
 * asks for (same FullItem columns the BOM sheet maps in lib/data-sources.ts), and its
 * raw-material components are the only codes offered.
 */

export type CreateBomInput = {
  bomId: string;
  bomIdType: string | null;
  fullItem: { itemType: string | null; size: string | null; pnGmd: string | null };
  components: { rawMaterial: { erpItemCode: string | null } | null }[];
};

export type BomCodeRecord = {
  bomId: string;
  valveType: string | null;
  size: string | null;
  pn: string | null;
  bomType: string;
  erpItemCode: string;
};

// The sheet writes "CREATE BOM"; tolerate underscore/case variants (the Notion task says CREATE_BOM).
export const isCreateBom = (type: string | null | undefined) => /^create[\s_-]*bom$/i.test((type ?? "").trim());

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/** One row per (CREATE BOM, distinct RM code); non-CREATE BOMs and codeless components are dropped. */
export function flattenCreateBoms(boms: CreateBomInput[]): BomCodeRecord[] {
  const out: BomCodeRecord[] = [];
  for (const b of boms) {
    if (!isCreateBom(b.bomIdType)) continue;
    const codes = new Set(b.components.map((c) => clean(c.rawMaterial?.erpItemCode)).filter((c): c is string => !!c));
    for (const erpItemCode of codes) {
      out.push({
        bomId: b.bomId,
        valveType: clean(b.fullItem.itemType),
        size: clean(b.fullItem.size),
        pn: clean(b.fullItem.pnGmd),
        bomType: b.bomIdType!.trim(),
        erpItemCode,
      });
    }
  }
  return out;
}
