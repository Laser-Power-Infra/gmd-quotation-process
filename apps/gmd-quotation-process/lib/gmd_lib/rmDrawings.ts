import { prisma } from "@/lib/prisma";
import { cell, readSheetTabByGid, requireColumns } from "./bomMastErp";

/**
 * Puja's "RM drawing map (Asmita)" tab -> RawMaterial.drawingUrl, matched on
 * erpItemCode (trimmed, upper-cased). Runs hourly as the last step of the
 * raw-material job and by hand via `pnpm rm:drawings` (dry run) / `rm:drawings:apply`.
 *
 * Set-only: a code missing from the sheet, or listed there without a link
 * ("DRAWING MISSING"), keeps whatever is stored.
 */
export const RM_DRAWINGS_SPREADSHEET_ID = "1SivNhCB56wN_G8tFvHdxCbuKxt7ocDvXCinPhOA9qBc";
export const RM_DRAWINGS_GID = 588349458;

/**
 * Code -> its distinct drawing links in sheet order, joined ", " ("" when the
 * code is listed without one). A code can sit on several rows with different
 * drawings (RXS140009 is both a tail and a drive stub shaft), so every link is
 * kept; links that differ only by query string (?usp=sharing) are one drawing.
 */
export function drawingsByCode(tab: {
  tabTitle: string;
  headers: string[];
  rows: string[][];
}): Map<string, string> {
  const [codeIdx, linkIdx] = requireColumns(tab.headers, ["RM CODE", "DRAWING LINK"], tab.tabTitle);
  const links = new Map<string, Map<string, string>>(); // code -> (url without query -> url as first seen)
  for (const row of tab.rows) {
    const code = cell(row, codeIdx).toUpperCase();
    if (!code || code === "RM CODE") continue; // blank, or the header repeated
    const seen = links.get(code) ?? new Map<string, string>();
    links.set(code, seen);
    for (const [url] of cell(row, linkIdx).matchAll(/https?:\/\/[^\s,]+/gi)) {
      const key = url.split("?")[0];
      if (!seen.has(key)) seen.set(key, url);
    }
  }
  return new Map([...links].map(([code, seen]) => [code, [...seen.values()].join(", ")]));
}

export type RmDrawingSyncResult = {
  /** Distinct RM codes listed in the sheet. */
  sheetCodes: number;
  /** Of those, codes with at least one drawing link. */
  withLink: number;
  /** RawMaterial rows whose code has a drawing in the sheet. */
  matched: number;
  /** Matched rows whose drawingUrl changed (would change, on a dry run). */
  updated: number;
  /** Codes with a drawing that match no RawMaterial row. */
  notInRm: string[];
  /** Up to 10 `CODE: "old" -> "new"` lines. */
  samples: string[];
  /** Dry run before the drawingUrl migration is deployed: every stored value was read as blank. */
  columnMissing: boolean;
};

export async function syncRmDrawings({ dryRun = false } = {}): Promise<RmDrawingSyncResult> {
  const byCode = drawingsByCode(await readSheetTabByGid(RM_DRAWINGS_SPREADSHEET_ID, RM_DRAWINGS_GID));

  let columnMissing = false;
  const rows = await prisma.rawMaterial
    .findMany({ select: { id: true, erpItemCode: true, drawingUrl: true } })
    .catch(async (err: unknown) => {
      // shortcut: lets the dry run work before migration 20261118100100 is deployed; remove once it is.
      if (!dryRun || (err as { code?: unknown })?.code !== "P2022") throw err; // P2022 = column does not exist
      columnMissing = true;
      const bare = await prisma.rawMaterial.findMany({ select: { id: true, erpItemCode: true } });
      return bare.map((r) => ({ ...r, drawingUrl: null }));
    });

  const found = new Set<string>();
  const idsByUrl = new Map<string, string[]>();
  const samples: string[] = [];
  let matched = 0;
  for (const row of rows) {
    const code = (row.erpItemCode ?? "").trim().toUpperCase();
    const url = byCode.get(code);
    if (!url) continue;
    found.add(code);
    matched++;
    if (url === (row.drawingUrl ?? "")) continue;
    idsByUrl.set(url, [...(idsByUrl.get(url) ?? []), row.id]);
    if (samples.length < 10) samples.push(`${code}: "${row.drawingUrl ?? ""}" -> "${url}"`);
  }

  // One write per distinct value: a few dozen drawings cover every code.
  let updated = 0;
  for (const [drawingUrl, ids] of idsByUrl) {
    updated += dryRun
      ? ids.length
      : (await prisma.rawMaterial.updateMany({ where: { id: { in: ids } }, data: { drawingUrl } })).count;
  }

  return {
    sheetCodes: byCode.size,
    withLink: [...byCode.values()].filter(Boolean).length,
    matched,
    updated,
    notInRm: [...byCode].filter(([code, url]) => url && !found.has(code)).map(([code]) => code),
    samples,
    columnMissing,
  };
}
