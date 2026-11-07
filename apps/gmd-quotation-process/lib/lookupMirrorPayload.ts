export type LookupRow = {
  id: string; type: string; value: string; sortOrder: number; isActive: boolean;
  code: string | null; defaultState: string | null; createdAt: Date; updatedAt: Date;
};

export function buildMirrorPayload(rows: LookupRow[], deleteIds: string[]) {
  return {
    upsert: rows.map((r) => ({
      id: r.id, type: r.type, value: r.value, sortOrder: r.sortOrder, isActive: r.isActive,
      code: r.code, defaultState: r.defaultState,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    })),
    delete: deleteIds,
  };
}
