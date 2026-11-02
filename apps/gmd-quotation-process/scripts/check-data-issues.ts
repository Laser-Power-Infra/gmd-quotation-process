/**
 * READ-ONLY checker for the "Power BI / sheet data issues" task. Writes nothing.
 * Lists what this repo's synced ledger data can show:
 *   2. creditor advances of Rs 0.01 - 0.33 (leftover entries, Accounts to clean in ERP)
 *   3. voucher-wise negative balances (debtors, creditors)
 *   5. ledger freshness (Debtors page last synced)
 * Not checkable here (no data in the app): negative Production Register time, stray Power BI "Page 1".
 *
 *   npx tsx scripts/check-data-issues.ts
 */
import "dotenv/config";
import { prisma } from "@gmd/db-quotation";

const n = (v: { toString(): string } | null) => (v === null ? 0 : Number(v.toString()));

async function main() {
  const advs = await prisma.creditorAdvance.findMany({ select: { accCode: true, vrNo: true, vrDate: true, unAllocDr: true } });
  const small = advs.filter((a) => n(a.unAllocDr) > 0 && n(a.unAllocDr) <= 0.33);
  console.log(`\n[2] Creditor advances Rs 0.01-0.33: ${small.length} of ${advs.length}`);
  for (const a of small.slice(0, 15)) console.log(`  ${a.accCode} ${a.vrNo} ${a.vrDate?.toISOString().slice(0, 10) ?? ""} ${n(a.unAllocDr)}`);
  if (small.length > 15) console.log(`  ... ${small.length - 15} more`);

  const deb = await prisma.debtor.findMany({ select: { accCode: true, vrNo: true, unAllocDr: true, unAllocCr: true, syncedAt: true } });
  const cred = await prisma.creditor.findMany({ select: { accCode: true, vrNo: true, unAllocCr: true, syncedAt: true } });
  const negD = deb.filter((r) => n(r.unAllocDr) - n(r.unAllocCr) < 0);
  const negC = cred.filter((r) => n(r.unAllocCr) < 0);
  console.log(`\n[3] Negative voucher balances: debtors ${negD.length}/${deb.length}, creditors ${negC.length}/${cred.length}`);
  for (const r of negD.slice(0, 10)) console.log(`  debtor ${r.accCode} ${r.vrNo} ${n(r.unAllocDr) - n(r.unAllocCr)}`);
  for (const r of negC.slice(0, 10)) console.log(`  creditor ${r.accCode} ${r.vrNo} ${n(r.unAllocCr)}`);

  const last = (rows: { syncedAt: Date }[]) => rows.reduce<Date | null>((m, r) => (!m || r.syncedAt > m ? r.syncedAt : m), null);
  console.log(`\n[5] Last synced: debtors ${last(deb)?.toISOString() ?? "never"}, creditors ${last(cred)?.toISOString() ?? "never"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
