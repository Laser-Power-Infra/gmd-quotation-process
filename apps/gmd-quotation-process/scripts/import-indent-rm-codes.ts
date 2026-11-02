import "dotenv/config";
import * as XLSX from "xlsx";
import path from "path";
import { prisma } from "@/lib/prisma";
import { applyTpavSlvMerge } from "@/lib/indentListingFamilySum";

/**
 * One-off: fill IndentListing.rmCodeV1..V4 from Puja's FINAL mapping workbook.
 * Usage (from apps/gmd-quotation-process):
 *   npx tsx scripts/import-indent-rm-codes.ts [xlsx path]           // dry-run
 *   npx tsx scripts/import-indent-rm-codes.ts [xlsx path] --apply   // writes, one transaction
 *
 * The sheet is keyed on the Indent Listing as DISPLAYED (TPAV+SLV folded into
 * TPAV/SLV), so matching and writes follow the same path as
 * updateIndentRmCodeAction: a displayed row's slot value is written to every
 * stored row behind it. Sheet item "TPAV-isolation SLV" belongs to the TPAV row.
 */

const DEFAULT_FILE = path.resolve(process.cwd(), "../../tmp/GMD_Indent_RM_Code_Mapping_FINAL.xlsx");
const RM_IDX = [13, 14, 15, 16];
const V_IDX = [5, 6, 7, 8];

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const normSize = (v: unknown) => norm(v).replace(/\s*MM$/, "").replace(/\s+/g, "");
const normItem = (v: unknown) => {
  const s = norm(v);
  return s === "TPAV-ISOLATION SLV" ? "TPAV" : s;
};
const key = (item: unknown, size: unknown, pn: unknown, mc: unknown) =>
  [normItem(item), normSize(size), norm(pn), norm(mc)].join("|");
const splitCodes = (v: unknown) =>
  String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

interface Line {
  indentRow: string;
  item: string;
  size: string;
  pn: string;
  mc: string;
  variant: string;
  qty: unknown;
  codes: string[];
  spec: string;
}

function parseRows(s: string): Set<string> {
  const out = new Set<string>();
  for (const part of s.split(",")) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(String(i));
    else if (part.trim()) out.add(part.trim());
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DEFAULT_FILE;
  console.log(`\n=== Import indent RM codes — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n${file}\n`);

  const wb = XLSX.readFile(file);
  const mapping: any[] = XLSX.utils.sheet_to_json(wb.Sheets["Mapping"], { defval: "" });
  const toCreate: any[] = XLSX.utils.sheet_to_json(wb.Sheets["Items to Create"], { defval: "" });

  // New codes from "Items to Create": spec -> [{rows, codes}]
  const newCodes = toCreate
    .map((r) => ({
      spec: norm(r["Item to create (spec)"]),
      rows: parseRows(String(r["Indent rows"] ?? "")),
      codes: splitCodes(r["New RM code (Asmita)"]),
    }))
    .filter((r) => r.codes.length > 0);

  const lines: Line[] = [];
  for (const r of mapping) {
    if (norm(r["Status"]) === "NO ITEM NAME") continue;
    const indentRow = String(r["Indent Row"]).trim();
    const spec = String(r["RM Spec / Item to create"] ?? "");
    const codes = splitCodes(r["Proposed RM Code"]);
    if (norm(r["Status"]) === "MISSING") {
      for (const n of newCodes) {
        if (n.spec === norm(spec) && n.rows.has(indentRow)) codes.push(...n.codes);
      }
    }
    lines.push({
      indentRow,
      item: r["Item"], size: r["Size"], pn: r["PN"], mc: r["MC"],
      variant: norm(r["Variant"]), qty: r["Var Qty"], codes, spec,
    });
  }

  const items = await prisma.indentListing.findMany({ orderBy: { item: "asc" } });
  const raw = items.map((i) => [
    i.item, i.size, i.pnRating, i.mcReceivedPending,
    i.totalBalBillAgCont != null ? String(i.totalBalBillAgCont) : null,
    i.v1, i.v2, i.v3, i.v4, i.v1Category, i.v2Category, i.v3Category, i.v4Category,
    i.rmCodeV1, i.rmCodeV2, i.rmCodeV3, i.rmCodeV4,
  ]);
  const { rows, ids, sourceIds } = applyTpavSlvMerge(raw, items.map((i) => i.id));
  const byKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = key(r[0], r[1], r[2], r[3]);
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  const stored = new Map(items.map((i) => [i.id, i]));

  // group lines by displayed row + slot
  const groups = new Map<string, { row: number; slot: number; codes: Set<string>; lines: Line[] }>();
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const l of lines) {
    const label = `Indent Row ${l.indentRow}: ${l.item} ${l.size} ${l.pn} ${l.mc} ${l.variant}`;
    const hits = byKey.get(key(l.item, l.size, l.pn, l.mc)) ?? [];
    if (hits.length !== 1) {
      problems.push(`${hits.length === 0 ? "NO DB MATCH" : `AMBIGUOUS (${hits.length})`}  ${label}`);
      continue;
    }
    const row = hits[0];
    let slot: number;
    const vm = l.variant.match(/^V([1-4])$/);
    if (vm) slot = +vm[1] - 1;
    else {
      const pop = [0, 1, 2, 3].filter((s) => Number.isFinite(parseFloat(String(rows[row][V_IDX[s]] ?? ""))));
      const nz = pop.filter((s) => parseFloat(String(rows[row][V_IDX[s]])) !== 0);
      const pick = nz.length ? nz : pop;
      if (pick.length > 1) {
        problems.push(`VARIANT '-' AMBIGUOUS SLOT (populated: ${pick.map((s) => "V" + (s + 1)).join(",")})  ${label}`);
        continue;
      }
      // shortcut: no populated slot (qty only in the total) falls back to V1/Base; confirm if that is wrong
      if (pick.length === 0) warnings.push(`variant '-' with no populated slot in DB, used V1  ${label}`);
      slot = pick.length ? pick[0] : 0;
    }
    const dbQty = parseFloat(String(rows[row][V_IDX[slot]] ?? ""));
    if (!Number.isFinite(dbQty)) warnings.push(`slot V${slot + 1} has no qty in DB  ${label}`);
    else if (Number(l.qty) !== dbQty) warnings.push(`qty differs sheet ${l.qty} vs DB ${dbQty} (V${slot + 1})  ${label}`);
    const g = groups.get(`${row}:${slot}`) ?? { row, slot, codes: new Set<string>(), lines: [] };
    l.codes.forEach((c) => g.codes.add(c));
    g.lines.push(l);
    groups.set(`${row}:${slot}`, g);
  }

  // slot decisions + per stored row writes (own row beats a folded-in compound row)
  let changed = 0, cleared = 0, unchanged = 0;
  const writes: { id: string; slot: number; value: string }[] = [];
  const notPersistable: string[] = [];
  const compoundWants: { tag: string; item: string; slot: number; codes: string[]; tpavCodes: string[]; isoCodes: string[]; sources: string[] }[] = [];
  const tableRows: string[] = [];
  for (const g of groups.values()) {
    const next = [...g.codes].join(", ");
    const r = rows[g.row];
    const tag = `${r[0]} ${r[1]} ${r[2]} ${r[3]} V${g.slot + 1}`;
    // Only a stored row of the displayed item can hold the value: a synthesized
    // TPAV/SLV row exists only through a shared TPAV+SLV compound row, so writing
    // there would also change the sibling item's display.
    const own = stored.get(ids[g.row]);
    if (!own) { notPersistable.push(`${tag} -> "${next}"`); if (next !== "") compoundWants.push({ tag, item: norm(r[0]), slot: g.slot, codes: [...g.codes], tpavCodes: norm(r[0]) !== "TPAV" ? [] : g.lines.filter((l) => norm(l.item) !== "TPAV-ISOLATION SLV").flatMap((l) => l.codes), isoCodes: g.lines.filter((l) => norm(l.item) === "TPAV-ISOLATION SLV").flatMap((l) => l.codes), sources: sourceIds[g.row] }); continue; }
    const cur = String((own as any)[`rmCodeV${g.slot + 1}`] ?? "");
    if (cur === next) { unchanged++; continue; }
    if (next === "") { cleared++; tableRows.push(`${tag}: "${cur}" -> "" (CLEAR)`); }
    else { changed++; tableRows.push(`${tag}: "${cur}" -> "${next}"`); }
    writes.push({ id: own.id, slot: g.slot, value: next });
  }

  // Displayed rows with no stored row of their own (synthesized TPAV/SLV) live only through
  // TPAV+SLV compound rows. Write the union of every wanted code onto each compound slot that
  // feeds that displayed slot (compound's own V1..V4 + category; TPAV re-homes slots, SLV doesn't).
  // Never writes a blank over a compound slot.
  const tpavSlot = (cat: string) => {
    const c = cat.toUpperCase();
    return c.includes("9523") ? 3 : c.includes("DI") ? 0 : c.includes("CS") || c.includes("WAFER") ? 1 : 0;
  };
  const compoundTarget = new Map<string, { id: string; slot: number; tpav: Set<string>; iso: Set<string> }>();
  for (const w of compoundWants) {
    for (const id of w.sources) {
      const c: any = stored.get(id);
      if (!c) continue;
      for (let s = 0; s < 4; s++) {
        if (!Number.isFinite(parseFloat(String(c[`v${s + 1}`] ?? "")))) continue;
        const homed = w.item === "TPAV" ? tpavSlot(String(c[`v${s + 1}Category`] ?? "")) : s;
        if (homed !== w.slot) continue;
        const k = `${id}:${s}`;
        const t = compoundTarget.get(k) ?? { id, slot: s, tpav: new Set<string>(), iso: new Set<string>() };
        w.tpavCodes.forEach((x) => t.tpav.add(x));
        w.isoCodes.forEach((x) => t.iso.add(x));
        compoundTarget.set(k, t);
      }
    }
  }
  const compoundLines: string[] = [];
  const compoundUnions: string[] = [];
  for (const t of compoundTarget.values()) {
    const c: any = stored.get(t.id);
    const cur = String(c[`rmCodeV${t.slot + 1}`] ?? "");
    // SLV part: the SLV sheet row's codes for this exact slot; if that SLV row is not in the sheet,
    // the isolation-line codes; otherwise (SLV row present but blank) what is already stored.
    const slvHits = byKey.get(key("SLV", c.size, c.pnRating, c.mcReceivedPending)) ?? [];
    const slvGroup = slvHits.length === 1 ? groups.get(`${slvHits[0]}:${t.slot}`) : undefined;
    const slvPart = slvGroup
      ? (slvGroup.codes.size ? [...slvGroup.codes] : splitCodes(cur))
      : (t.iso.size ? [...t.iso] : splitCodes(cur));
    const next = [...new Set([...t.tpav, ...slvPart])].join(", ");
    const tag = `COMPOUND ${c.item} ${c.size} ${c.pnRating} ${c.mcReceivedPending} V${t.slot + 1}`;
    if (next === "") continue; // never blank a compound slot
    const dropped = splitCodes(cur).filter((x) => !splitCodes(next).includes(x));
    if (dropped.length) compoundUnions.push(`${tag}: stored code(s) ${dropped.join(", ")} dropped (replaced by "${next}")`);
    if (cur === next) continue;
    compoundLines.push(`${tag}: "${cur}" -> "${next}"`);
    writes.push({ id: t.id, slot: t.slot, value: next });
  }

  // Report-only: every code to be written should be a live (newItemStatus null or "Updated") GMDUpdateItem row.
  const wanted = [...new Set(writes.flatMap((w) => splitCodes(w.value)))];
  const master = await prisma.gMDUpdateItem.findMany({
    where: { erpItemCode: { in: wanted } },
    select: { erpItemCode: true, newItemStatus: true },
  });
  const live = new Set(master.filter((m) => m.newItemStatus == null || m.newItemStatus === "Updated").map((m) => m.erpItemCode));
  const inMaster = new Set(master.map((m) => m.erpItemCode));
  const missingCodes = wanted.filter((c) => !inMaster.has(c));
  const closedCodes = wanted.filter((c) => inMaster.has(c) && !live.has(c));

  tableRows.sort().forEach((t) => console.log(t));
  console.log(`\nCODES NOT IN RM MASTER: ${missingCodes.join(", ") || "none"}`);
  console.log(`CODES ONLY NON-LIVE (CLOSED / TO BE CLOSED / TO BE LOCKED) IN RM MASTER: ${closedCodes.map((c) => `${c} (${master.filter((m) => m.erpItemCode === c).map((m) => m.newItemStatus).join("/")})`).join(", ") || "none"}`);
  console.log("\nCOMPOUND WRITES (" + compoundLines.length + "):\n" + compoundLines.join("\n"));
  console.log("\nCOMPOUND SLOTS WHERE A STORED CODE IS DROPPED (" + compoundUnions.length + "):\n" + compoundUnions.join("\n"));
  console.log(`\nSheet lines: ${lines.length}, displayed row/slot groups: ${groups.size}`);
  console.log(`changed ${changed}, cleared ${cleared}, unchanged ${unchanged}, unmatched/ambiguous sheet lines ${problems.length}, not persistable ${notPersistable.length}`);
  console.log(`DB updates needed: ${writes.length}`);
  console.log(`No-own-row displayed slots routed to compound rows: ${notPersistable.length}`);
  if (problems.length) console.log("\nUNMATCHED / AMBIGUOUS:\n" + problems.join("\n"));
  if (warnings.length) console.log("\nWARNINGS:\n" + warnings.join("\n"));

  if (!apply) { console.log("\nDry-run only. Re-run with --apply to write."); return; }
  await prisma.$transaction(
    writes.map((w) =>
      prisma.indentListing.update({ where: { id: w.id }, data: { [`rmCodeV${w.slot + 1}`]: w.value } }),
    ),
    { timeout: 120_000 },
  );
  console.log(`\nApplied ${writes.length} stored-row updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
