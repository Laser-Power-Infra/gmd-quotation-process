// Utility master + old→new mapping shared by the quotation app (seed/remap
// scripts) and the tender app (Smartsheet upsert, utility filters). Source CSVs
// live in apps/gmd-quotation-process/data; utilityMasterData.ts embeds the same
// text (generated alongside the CSVs) so the tender app needs no file access.
import { UTILITY_MASTER_CSV, UTILITY_MAPPING_CSV } from "./utilityMasterData";
export { UTILITY_MASTER_CSV, UTILITY_MAPPING_CSV };

export type UtilityMasterRow = { code: string; name: string; shortName: string; state: string };
export type UtilityMappingRow = {
  oldValue: string;
  newShortName: string;
  projectReference: string;
  verify: boolean;
};
export type UtilityResolution =
  | { kind: "map"; utility: string; projectReference: string }
  | { kind: "verify" }
  | { kind: "unmatched" };

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
    newShortName: r.newShortName,
    projectReference: r.projectReference,
    verify: r.verify === "Y",
  }));
}

/**
 * Resolver for a stored utility text: mapping rows first (VERIFY rows resolve
 * to "verify" and must never be bulk-updated), then master full/short names so
 * already-canonical values are recognised. Trim + case/space-insensitive.
 */
export function buildUtilityResolver(
  master: UtilityMasterRow[],
  mapping: UtilityMappingRow[],
): (value: string | null | undefined) => UtilityResolution {
  const byKey = new Map<string, UtilityResolution>();
  for (const m of master) {
    const hit: UtilityResolution = { kind: "map", utility: m.shortName, projectReference: "" };
    byKey.set(normalizeUtility(m.name), hit);
    byKey.set(normalizeUtility(m.shortName), hit);
  }
  for (const m of mapping) {
    byKey.set(
      normalizeUtility(m.oldValue),
      m.verify || !m.newShortName
        ? { kind: "verify" }
        : { kind: "map", utility: m.newShortName, projectReference: m.projectReference },
    );
  }
  return (value) => byKey.get(normalizeUtility(value)) ?? { kind: "unmatched" };
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

let embedded: ReturnType<typeof buildUtilityResolver> | null = null;
/** Resolver over the embedded master + mapping (no file/DB access). */
export function embeddedUtilityResolver() {
  return (embedded ??= buildUtilityResolver(
    parseUtilityMaster(UTILITY_MASTER_CSV),
    parseUtilityMapping(UTILITY_MAPPING_CSV),
  ));
}

/** Canonical short name for a raw value, or the trimmed raw value when VERIFY/unmatched. */
export function canonicalUtility(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const r = embeddedUtilityResolver()(raw);
  return r.kind === "map" ? r.utility : raw;
}

/** Standard utility names (master short names), in master order: the only utility filter options. */
export function utilityMasterNames(): string[] {
  return parseUtilityMaster(UTILITY_MASTER_CSV).map((m) => m.shortName);
}
