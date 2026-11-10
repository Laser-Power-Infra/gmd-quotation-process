// Pure rules linking actuator / gearbox ERP codes to stock and BOM lines (no DB).
// An ACT CODE maps to stock via ERP code: Rotork K-series lines carry an ACT CODE, AUMA SA lines have none (never guessed).

/** A real ERP item code (RCB040002, RL2010003). MAPPING's gearbox column also holds text like "Bevel/spur – see GMD_GB_STOCK". */
export const isErpCode = (s: string | null | undefined) => /^[A-Z]{2,3}\d{6,7}$/i.test((s ?? "").trim());

export interface StockCodes { act: string[]; gb: string | null }

/** ERP codes that carry the stock of an item's actuator and gearbox. Anything that is not a real code means "no stock code". */
export function resolveStockCodes(
  it: { actCode?: string | null; gbCode?: string | null },
  mappingGmdGb: string | null | undefined,
  actStock: { erpCode: string; actCode: string | null }[],
): StockCodes {
  const act = it.actCode ? actStock.filter((a) => a.actCode === it.actCode).map((a) => a.erpCode) : [];
  // A hand-typed real ERP code in GB CODE wins; otherwise the GMD stock gearbox of the MAPPING row.
  const gb = [it.gbCode, mappingGmdGb].map((c) => c?.trim()).find((c) => isErpCode(c)) ?? null;
  return { act, gb };
}

export interface ItemStock {
  actCode: string | null; gbCode: string | null; // codes the figures were read for (stale once these change)
  actErp: string[]; gbErp: string | null;
  actFree: number | null; gbFree: number | null; // null = no stock code
  need: number | null;
  short: string[]; // "actuator" / "gearbox" when free qty < docket qty
}

/** Free qty = live Physical Stock available qty summed per ERP code. Short when it is below the docket qty. */
export function stockSummary(
  it: { actCode?: string | null; gbCode?: string | null }, codes: StockCodes, live: Map<string, number>, need: number | null,
): ItemStock {
  const sum = (cs: string[]) => (cs.length ? cs.reduce((s, c) => s + (live.get(c) ?? 0), 0) : null);
  const actFree = sum(codes.act);
  const gbFree = sum(codes.gb ? [codes.gb] : []);
  const low = (free: number | null) => free !== null && need !== null && free < need;
  return {
    actCode: it.actCode ?? null, gbCode: it.gbCode ?? null, actErp: codes.act, gbErp: codes.gb, actFree, gbFree, need,
    short: [low(actFree) ? "actuator" : "", low(gbFree) ? "gearbox" : ""].filter(Boolean),
  };
}

/** Chip label: OK only for what was actually checked against a stock code. */
export function stockLabel(s: ItemStock): string {
  if (s.actFree === null && s.gbFree === null) return "No stock code";
  if (s.short.length) return `Short: ${s.short.join(" + ")} stock`;
  const checked = [s.actFree !== null ? "actuator" : "", s.gbFree !== null ? "gearbox" : ""].filter(Boolean);
  return `${checked.join(" + ")} stock OK`;
}

/** One-line text for the chip tooltip. */
export function stockText(s: ItemStock): string {
  const part = (label: string, free: number | null) => (free === null ? `${label}: no stock code` : `${label}: ${free} free`);
  return `${part("ACT", s.actFree)} / ${part("GB", s.gbFree)}${s.need !== null ? ` (docket qty ${s.need})` : ""}${s.short.length ? ` - SHORT: ${s.short.join(", ")}` : ""}`;
}

export interface BomLine { code: string; qty: number }

/** Actuator and gearbox lines an actuated item's BOM still lacks. The actuator code is the one with most free qty (first on a tie). */
export function actuatorBomLines(codes: StockCodes, live: Map<string, number>, existing: BomLine[]): BomLine[] {
  const have = new Set(existing.map((l) => l.code.trim().toUpperCase()));
  const act = [...codes.act].sort((a, b) => (live.get(b) ?? 0) - (live.get(a) ?? 0))[0];
  return [act, codes.gb].filter((c): c is string => !!c && !have.has(c.toUpperCase())).map((code) => ({ code, qty: 1 }));
}

/** CREATE / Auto BOM draft lines: the copied lines minus any other size's actuator/gearbox lines, plus this item's own (same builder as EDIT drafts). */
export function createDraftLines(copied: BomLine[], skip: ReadonlySet<string>, codes: StockCodes, live: Map<string, number>): BomLine[] {
  const base = copied.filter((l) => !skip.has(l.code.trim()));
  return [...base, ...actuatorBomLines(codes, live, base)];
}

// ---- Mismatch report -------------------------------------------------------------------------------------------

export interface ActStockRow { erpCode: string; make: string | null; ratingCode: string | null; torque: number | null; available: number | null; physicalSum: number | null; stockPerErp: number | null; stockValue: number | null }
export interface GbStockRow { erpCode: string; gbType: string | null; ratedTorque: number | null; available: number | null; stockPerErp: number | null; remarks: string | null }

export function mismatchReport(act: ActStockRow[], gb: GbStockRow[]) {
  const n = (v: number | null) => v ?? 0;
  const sum = (rows: ActStockRow[], f: (r: ActStockRow) => number | null) => rows.reduce((s, r) => s + n(f(r)), 0);
  return {
    totals: {
      lines: act.length,
      rotork: act.filter((a) => a.make === "Rotork").length,
      auma: act.filter((a) => a.make === "AUMA").length,
      units: sum(act, (r) => r.available),
      value: sum(act, (r) => r.stockValue),
    },
    // ERP stock differs from physical (blank counts as 0, as the workbook's status column does).
    erpMismatch: act.filter((a) => n(a.stockPerErp) !== n(a.physicalSum)),
    gearboxCoded: gb.filter((g) => isErpCode(g.erpCode)),
    gearboxNeedsCode: gb.filter((g) => !isErpCode(g.erpCode)),
    // AUMA SA torque cannot be derived from the code: nameplate value to fill.
    aumaToFill: act.filter((a) => a.make === "AUMA" && a.torque === null),
  };
}
export type MismatchReport = ReturnType<typeof mismatchReport>;
