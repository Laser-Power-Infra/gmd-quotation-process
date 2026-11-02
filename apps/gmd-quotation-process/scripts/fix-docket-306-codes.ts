import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncAvailableBomIds } from "@/lib/itemBomSync";

/**
 * One-time fix: docket GMD/2026-27/306 carries four item codes that differ from
 * contract SD26Y-00058 (same size + qty), so CR rates cannot be fetched.
 *
 * Writes ONLY erpItemCode (+ availableBomIds, refreshed the same way the app does).
 * Rates, VA%, cost and the selected BOM are left alone: the quoted rates on these
 * lines are already the contract rates. A selected bomId that is not a candidate
 * of the new code is reported, not cleared — re-pick it in the dashboard.
 *
 * Each line is located by (old code, qty); the run aborts unless every line
 * matches exactly one item. The DN80 isolation valve (FSD040004 x 94) is kept.
 *
 * Usage:
 *   npx tsx scripts/fix-docket-306-codes.ts          // dry-run (no writes)
 *   npx tsx scripts/fix-docket-306-codes.ts --apply  // writes
 */

const DOCKET = "GMD/2026-27/306";
const FIXES = [
  { label: "Manual sluice DN80", from: "FSD040004", qty: 716, to: "FSD040044" },
  { label: "Air valve DN80", from: "FCF120008", qty: 94, to: "FVD010019" },
  { label: "DPCV DN80", from: "FCF090034", qty: 20, to: "FHD010023" },
  { label: "Manual sluice DN250", from: "FSC060014", qty: 8, to: "FSD040084" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== ${DOCKET} item code fix — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n`);

  const enquiry = await prisma.enquiry.findUnique({
    where: { docketNumber: DOCKET },
    select: { id: true, items: { select: { id: true, itemName: true, erpItemCode: true, quantity: true, bomId: true } } },
  });
  if (!enquiry) throw new Error(`${DOCKET} not found`);

  const plan = FIXES.map((f) => {
    const hits = enquiry.items.filter((i) => i.erpItemCode === f.from && Number(i.quantity) === f.qty);
    const already = enquiry.items.filter((i) => i.erpItemCode === f.to && Number(i.quantity) === f.qty);
    return { ...f, hits, already };
  });

  let bad = false;
  for (const p of plan) {
    if (p.hits.length === 1) {
      console.log(`  ${p.label}: ${p.from} -> ${p.to} (qty ${p.qty}) item=${p.hits[0].id} "${p.hits[0].itemName}"`);
    } else if (p.hits.length === 0 && p.already.length === 1) {
      console.log(`  ${p.label}: already ${p.to} (qty ${p.qty}), skip`);
    } else {
      console.log(`  ${p.label}: expected 1 item with ${p.from} x ${p.qty}, found ${p.hits.length} — ABORT`);
      bad = true;
    }
  }
  if (bad) throw new Error("Docket no longer matches the expected lines; nothing written.");

  const todo = plan.filter((p) => p.hits.length === 1);
  if (!apply) {
    console.log(`\n${todo.length} line(s) would change. Re-run with --apply to write.`);
    return;
  }

  for (const p of todo) {
    const item = p.hits[0];
    await prisma.enquiryItem.update({ where: { id: item.id }, data: { erpItemCode: p.to } });
    const candidates = await syncAvailableBomIds(item.id, p.to);
    const stale = item.bomId && !candidates.includes(item.bomId);
    console.log(`  wrote ${p.to} on ${item.id}; BOM candidates=[${candidates.join(", ")}]${stale ? ` — selected bomId ${item.bomId} is not a candidate, re-pick it` : ""}`);
  }
  console.log(`\nDone: ${todo.length} line(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
