// Utility master + old→new mapping shared by the quotation app (seed/remap
// scripts, supply-history sync) and the tender app (Smartsheet upsert). The
// standard utility list is the active UTILITY LookupOption rows (quotation DB,
// loaded by ../server/utility.ts); the CSVs only add aliases for old text.
// Source CSVs live in apps/gmd-quotation-process/data; utilityMasterData.ts
// embeds the same text (generated alongside the CSVs) so the tender app needs
// no file access.
import { UTILITY_MASTER_CSV, UTILITY_MAPPING_CSV } from "./utilityMasterData";
export { UTILITY_MASTER_CSV, UTILITY_MAPPING_CSV };

export type UtilityMasterRow = { code: string; name: string; shortName: string; state: string };
export type UtilityMappingRow = {
  oldValue: string;
  newCode: string;
  newShortName: string;
  projectReference: string;
  verify: boolean;
};
export type UtilityResolution =
  | { kind: "map"; utility: string; projectReference: string }
  | { kind: "verify" }
  | { kind: "unmatched" };
export type UtilityResolver = (value: string | null | undefined) => UtilityResolution;

/** Minimal RFC-4180 CSV parser (quoted fields, "" escapes, CRLF). Returns header-keyed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// "&" == "and" so e.g. "GUJARAT WATER SUPPLY & SEWERAGE BOARD" meets the master name.
export const normalizeUtility = (v: string | null | undefined) =>
  String(v ?? "").replace(/&/g, " and ").trim().replace(/\s+/g, " ").toLowerCase();

export function parseUtilityMaster(csv: string): UtilityMasterRow[] {
  return parseCsv(csv).map((r) => ({ code: r.code, name: r.name, shortName: r.shortName, state: r.state }));
}

export function parseUtilityMapping(csv: string): UtilityMappingRow[] {
  return parseCsv(csv).map((r) => ({
    oldValue: r.oldValue,
    newCode: r.newCode,
    newShortName: r.newShortName,
    projectReference: r.projectReference,
    verify: r.verify === "Y",
  }));
}

/**
 * Resolver for a stored utility text: master full names, then mapping rows
 * (VERIFY rows resolve to "verify" and must never be bulk-updated), then master
 * short names, so a standard name always resolves to itself.
 * Trim + case/space-insensitive.
 */
export function buildUtilityResolver(
  master: UtilityMasterRow[],
  mapping: UtilityMappingRow[],
): UtilityResolver {
  const byKey = new Map<string, UtilityResolution>();
  const hit = (m: UtilityMasterRow): UtilityResolution => ({ kind: "map", utility: m.shortName, projectReference: "" });
  for (const m of master) byKey.set(normalizeUtility(m.name), hit(m));
  for (const m of mapping) {
    byKey.set(
      normalizeUtility(m.oldValue),
      m.verify || !m.newShortName
        ? { kind: "verify" }
        : { kind: "map", utility: m.newShortName, projectReference: m.projectReference },
    );
  }
  for (const m of master) byKey.set(normalizeUtility(m.shortName), hit(m));
  return (value) => byKey.get(normalizeUtility(value)) ?? { kind: "unmatched" };
}

/**
 * Resolver onto the active UTILITY LookupOption values. The master CSV full
 * name and the mapping CSV are aliases, both joined on the LookupOption code.
 */
export function lookupUtilityResolver(rows: { value: string; code: string | null }[]): UtilityResolver {
  const fullName = new Map(parseUtilityMaster(UTILITY_MASTER_CSV).map((m) => [m.code, m.name]));
  const values = new Set(rows.map((r) => r.value));
  const valueByCode = new Map(rows.filter((r) => r.code).map((r) => [r.code, r.value]));
  return buildUtilityResolver(
    rows.map((r) => ({ code: r.code ?? "", name: fullName.get(r.code ?? "") ?? r.value, shortName: r.value, state: "" })),
    parseUtilityMapping(UTILITY_MAPPING_CSV)
      // By code, so renaming a value on /admin/lookup-options keeps its aliases; no code match → the sheet's short name.
      .map((m) => ({ ...m, newShortName: valueByCode.get(m.newCode) ?? m.newShortName }))
      // An alias whose target is no longer a LookupOption value maps nothing, so no non-standard name is written.
      .filter((m) => m.verify || values.has(m.newShortName)),
  );
}

/**
 * Blank or a sheet dash placeholder ("-", "—") → null; a match → its LookupOption
 * value; any other text is kept as typed (trimmed) and counted in `unknown`.
 */
export function standardUtility(
  resolve: UtilityResolver,
  value: string | null | undefined,
  unknown: Map<string, number>,
): string | null {
  const raw = (value ?? "").trim();
  if (!raw || /^[-–—]+$/.test(raw)) return null;
  const r = resolve(raw);
  if (r.kind === "map") return r.utility;
  unknown.set(raw, (unknown.get(raw) ?? 0) + 1);
  return raw;
}

/** Blank → value; else append "; value" unless already present (idempotent re-runs). */
export function mergeProjectReference(current: string | null | undefined, add: string): string | null {
  const cur = (current ?? "").trim();
  const next = add.trim();
  if (!next) return cur || null;
  if (!cur) return next;
  if (cur.split(";").some((p) => normalizeUtility(p) === normalizeUtility(next))) return cur;
  return `${cur}; ${next}`;
}
