// Fills the actuator tables the Mapping page reads (db-quotation) from a parsed master: the live sheet when the page is
// opened (refreshActuatorTables), or an xlsx through scripts/import-actuator-master. Each MAPPING row also stores the app's
// own pick (selectActuator, the code docket pricing runs), so the page shows today's selection, view-only.
// Never re-prices dockets. DB, sheet and RM master are imported lazily: mappingRows stays pure and testable.
import type { Parsed } from "./actuatorMaster";
import { updateData } from "./actuatorMaster";
import { ACT_RULES, rmLookupCodes, selectActuator, type Master } from "./actuatorSelect";

export type Row = Record<string, string | number | null>;

const NO_FREE_STOCK = new Map<string, number>();

/**
 * One ActuatorMapping row per MAPPING key (origin INDIAN) and per imported (TFW) key (origin IMPORTED), each with the pick
 * for qty 1, no BOQ text and no free stock. `rm` = Raw Material master rate per ERP code.
 */
export function mappingRows(m: Master, rm: Map<string, number>): Row[] {
  const pick = (mapKey: string, origin: "INDIAN" | "IMPORTED"): Row => {
    const { selection: s, missing } = selectActuator({ mapKey, actuatorItem: false, qty: 1, text: "", origin }, m, NO_FREE_STOCK, rm);
    const total = s.act?.rate == null || (s.gb && s.gb.rate == null) ? null : s.act.rate + (s.gb?.rate ?? 0);
    const over = s.flags.find((f) => f.startsWith("Over "));
    return {
      origin,
      selGearbox: s.gb ? s.gb.model : s.act ? "Direct" : null,
      selGbRatio: s.gb?.ratio ?? null,
      selActuator: s.act ? `${s.act.make} ${s.act.model}` : null,
      selActRpm: s.act?.rpm ?? null,
      selTotal: total,
      selTime: s.time,
      selTimeCheck: s.time == null ? null : over ?? "OK",
      // Why a row has no pick or no price is as useful here as a flag: both go in the one column.
      selFlags: [...s.flags.filter((f) => f !== over), ...missing].join("; ") || null,
    };
  };
  // Valve turns as the pick counts them: quarter turn for a butterfly valve, DN ÷ 6.35 for an Indian multi-turn valve.
  const turns = (type: string, dn: number) => (/^BFV/.test(type) ? 0.25 : Math.round(dn / ACT_RULES.dnPerTurn));
  const indian = m.mappings.map((r): Row => {
    const mapKey = String(r.mapKey), [type = "", dn = "", pn = ""] = mapKey.split("|");
    return { valveType: type, dn: Number(dn), pn, ...r, valveTurns: turns(type, Number(dn)), ...pick(mapKey, "INDIAN") };
  });
  const imported = m.imported.map((r): Row => ({
    mapKey: r.mapKey, valveType: r.valveType, dn: r.dn, pn: r.pn, requiredTorque: r.requiredTorque, valveFlange: r.valveFlange,
    valveTurns: r.turns ?? 0.25,
    // selectActuator takes the item's own key (SLUICE|350|PN16) plus the origin, as a docket item gives it.
    ...pick(`${r.valveType.replace(/-IMP$/, "")}|${r.dn}|${r.pn}`, "IMPORTED"),
  }));
  return [...indian, ...imported];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- delegates are addressed by name, as the import script always did
type Db = any;

/**
 * Upserts the eight actuator tables by key and deletes rows no longer in the master. Throws before the first write when any
 * table would come out empty (a tab emptied by mistake must not wipe its table). Imported rows are kept when the master has
 * none: a missing TFW tab is an allowed state, not a reason to drop them.
 */
export async function writeActuatorTables(p: Parsed, mappings: Row[], db: Db, log: (line: string) => void = () => {}) {
  const tables: [name: string, delegate: string, key: string, rows: Row[]][] = [
    ["ActuatorMaster", "actuatorMaster", "actCode", p.actuators],
    ["GearboxMaster", "gearboxMaster", "gbCode", p.gearboxes],
    ["ValveTorque", "valveTorque", "key", p.valveTorques],
    ["ActuatorParam", "actuatorParam", "name", p.params],
    ["ActuatorMapping", "actuatorMapping", "mapKey", mappings],
    ["GmdGearboxStock", "gmdGearboxStock", "erpCode", p.gearboxStock],
    ["ActuatorStock", "actuatorStock", "erpCode", p.actuatorStock],
  ];
  for (const [name, , , rows] of tables) if (rows.length === 0) throw new Error(`${name}: no rows parsed, refusing to delete everything.`);
  if (!mappings.some((r) => r.origin === "INDIAN")) throw new Error("ActuatorMapping: no MAPPING rows parsed, refusing to delete everything.");
  if (p.suitability.length === 0) throw new Error("ActuatorSuitability: no rows parsed, refusing to delete everything.");

  const keepImported = !mappings.some((r) => r.origin === "IMPORTED");
  for (const [name, delegate, key, rows] of tables) {
    for (const data of rows) await db[delegate].upsert({ where: { [key]: data[key] }, update: updateData(data), create: data });
    const gone = { [key]: { notIn: rows.map((r) => r[key]) } };
    const removed = await db[delegate].deleteMany({
      where: name === "ActuatorMapping" && keepImported ? { ...gone, OR: [{ origin: null }, { origin: { not: "IMPORTED" } }] } : gone,
    });
    log(`${name}: ${rows.length} upserted, ${removed.count} removed.`);
  }
  // SUITABILITY (4k+ rows) is replaced as a whole inside one transaction.
  await db.$transaction([db.actuatorSuitability.deleteMany(), db.actuatorSuitability.createMany({ data: p.suitability })]);
  log(`ActuatorSuitability: ${p.suitability.length} rows written.`);
}

/** Reads the RM rates the pick needs and writes the tables with the default client. Used by the import script and the refresh. */
export async function syncActuatorTables(p: Parsed, log?: (line: string) => void) {
  const [{ prisma }, { buildRawMaterialsCostMap }] = await Promise.all([import("./prisma"), import("./gmd2to1CostLookup")]);
  await writeActuatorTables(p, mappingRows(p, await buildRawMaterialsCostMap(rmLookupCodes(p, []))), prisma, log);
}

const RETRY_MS = 60_000; // after a failed run: page clicks do not each wait on a sheet that is down
let lastGood = -Infinity, lastFail = -Infinity, lastError: string | null = null, running: Promise<string | null> | null = null;

// The reason shown on the page: one short line. A database error's text can name the host, so that step only quotes our own refusal.
const reason = (step: "read" | "save", e: unknown) => {
  const line = (e instanceof Error ? e.message : String(e)).trim().split("\n")[0].slice(0, 160);
  if (step === "read") return `the sheet could not be read: ${line}`;
  return /refusing to delete everything/.test(line) ? `a sheet tab came out empty: ${line}` : "the database could not be read or written";
};

/**
 * Refreshes the tables from the live sheet when the Mapping page is opened: at most once per `maxAgeMs` in this server
 * process (ruling D3: no scheduler). Callers that arrive during a run wait on that run, so two never overlap. Never throws:
 * a failed read or a refused write logs a warning, leaves the stored rows and resolves with the reason (null = fine). The
 * reason is kept until the next run, so a caller that did not wait for a run still learns it failed.
 */
export function refreshActuatorTables(
  maxAgeMs = 600_000,
  io: { load: () => Promise<Parsed>; sync: (p: Parsed) => Promise<void> } = {
    load: async () => (await import("./actuatorSheet")).loadActuatorMaster(),
    sync: syncActuatorTables,
  },
): Promise<string | null> {
  if (running) return running;
  const now = Date.now();
  // lastError, not a time comparison: a failure and a good run can carry the same millisecond.
  if (lastError != null && now - lastFail < Math.min(maxAgeMs, RETRY_MS)) return Promise.resolve(lastError);
  if (now - lastGood < maxAgeMs) return Promise.resolve(null);
  running = (async () => {
    let step: "read" | "save" = "read";
    try {
      const parsed = await io.load();
      step = "save";
      await io.sync(parsed);
      lastGood = Date.now();
      lastError = null;
    } catch (e) {
      lastFail = Date.now();
      lastError = reason(step, e);
      console.warn("[actuatorTablesSync] refresh from the live sheet failed, the stored rows stay:", e instanceof Error ? e.message : e);
    } finally {
      running = null;
    }
    return lastError;
  })();
  return running;
}

/**
 * The page's load path: waits on the refresh for at most `waitMs` (a slow or dead Google read must not hang the page), then
 * lets the run finish behind. Returns the line to show when the refresh failed; null when it is fine or still running.
 */
export async function refreshForPage(waitMs = 8000, refresh: () => Promise<string | null> = refreshActuatorTables): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = await Promise.race([refresh(), new Promise<null>((r) => { timer = setTimeout(r, waitMs, null); })]);
  clearTimeout(timer);
  return failed && `Could not refresh from the live sheet (${failed}). Showing the last stored rows.`;
}
