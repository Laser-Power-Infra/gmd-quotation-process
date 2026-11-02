/**
 * One-off data fix: fill the blank commercial terms of docket 087 and the blank
 * Contract Review payment terms of contract SD26Y-00076 from the customer PO.
 *
 * Dry-run by default: prints current values, the values that would be written and
 * the cost loading before/after per item. Nothing is written without --apply.
 *
 *   npx tsx scripts/fill-docket-087-terms.ts \
 *     --payment-terms "60 days Letter of credit prior to date of supply with interest in Buyer Account" \
 *     --inspection "Our Scope @ 1%" \
 *     --pbg "5% For 24 Months from date of invoice."
 *   ...same with --apply to write.
 *
 * Options:
 *   --docket <no>                 Docket number or serial (default "087": matches GMD/<fy>/087;
 *                                 pass the full number if more than one fiscal year has a 087).
 *   --contract <no>               Contract Review contract number (default "SD26Y-00076").
 *   --payment-terms <text>        PaymentTermsCost.terms value from the PO (exact text).
 *   --inspection <text>           InspectionCost.type value from the PO (exact text).
 *   --pbg <text>                  PbgCost.pbg value from the PO (exact text).
 *   --contract-payment-terms <t>  Contract Review payment terms; defaults to --payment-terms.
 *                                 Free text is allowed here (Contract Review is not a cost lookup).
 *   --force                       Overwrite non-blank values (default: fill blanks only).
 *   --apply                       Write the changes.
 *
 * Docket values must match the cost lookup tables exactly, otherwise the cost engine
 * silently loads 0% for them, which is the bug this fix is for.
 */
import fs from "fs";
import path from "path";

try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq !== -1) {
        const key = trimmed.slice(0, eq).trim();
        if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
} catch (err) {
  console.warn("Failed to load .env manually:", err);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const DOCKET = arg("docket") ?? "087";
const CONTRACT = arg("contract") ?? "SD26Y-00076";
const PAYMENT_TERMS = arg("payment-terms");
const INSPECTION = arg("inspection");
const PBG = arg("pbg");
const CONTRACT_PAYMENT_TERMS = arg("contract-payment-terms") ?? PAYMENT_TERMS;

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "<blank>" : String(v));

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { prisma: tenderPrisma } = await import("@gmd/db-tender");
  const { isBlankTerm, missingValidationTerms } = await import("../lib/commercialTerms");
  const { computeCostLoading, formatLoadingPct } = await import("../lib/costLoading");
  const { loadCostLoadingTables } = await import("../lib/costLoadingTables");
  const { recalculateEnquiryItems } = await import("../lib/costCalculator");
  const { isEnquiryFrozen } = await import("../lib/oneClickAccess");

  console.log(`\n=== FILL DOCKET ${DOCKET} / CONTRACT ${CONTRACT} TERMS [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);

  // 1. Resolve the docket.
  const candidates = await prisma.enquiry.findMany({
    where: DOCKET.includes("/") ? { docketNumber: DOCKET } : { docketNumber: { endsWith: `/${DOCKET}` } },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (candidates.length === 0) throw new Error(`No docket matches "${DOCKET}".`);
  if (candidates.length > 1) {
    throw new Error(`"${DOCKET}" matches ${candidates.length} dockets (${candidates.map((c) => c.docketNumber).join(", ")}). Pass the full number with --docket.`);
  }
  const enquiry = candidates[0];
  console.log(`Docket:        ${enquiry.docketNumber} (${enquiry.partyName})`);
  console.log(`Contract no(s): ${show(enquiry.contractNo.join(", "))} | selected: ${show(enquiry.selectedContractNo.join(", "))}`);
  console.log(`State:         ${show(enquiry.state)}`);
  console.log(`Payment terms: ${show(enquiry.paymentTerms)}`);
  console.log(`Inspection:    ${show(enquiry.inspection)}`);
  console.log(`PBG:           ${show(enquiry.pbg)}`);
  console.log(`APM / PDF:     ${show(enquiry.apm)} / ${show(enquiry.offerPdfGeneratedAt?.toISOString())}`);
  const missingNow = missingValidationTerms(enquiry);
  console.log(`Missing terms: ${missingNow.length ? missingNow.join(", ") : "(none)"}`);

  // 2. Check the PO values against the cost lookup tables.
  const tables = await loadCostLoadingTables();
  const proposed: Record<"paymentTerms" | "inspection" | "pbg", string | undefined> = {
    paymentTerms: PAYMENT_TERMS,
    inspection: INSPECTION,
    pbg: PBG,
  };
  const lookup = { paymentTerms: tables.paymentTerms, inspection: tables.inspection, pbg: tables.pbg };
  const errors: string[] = [];
  const data: Record<string, string> = {};
  for (const key of ["paymentTerms", "inspection", "pbg"] as const) {
    const value = proposed[key];
    const current = enquiry[key];
    if (value === undefined) {
      if (isBlankTerm(current)) errors.push(`--${key === "paymentTerms" ? "payment-terms" : key} is required (blank on the docket).`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(lookup[key], value)) {
      errors.push(`"${value}" is not a ${key} value in the cost lookup table. Valid values:\n    - ${Object.keys(lookup[key]).sort().join("\n    - ")}`);
      continue;
    }
    if (!isBlankTerm(current) && current !== value && !FORCE) {
      console.log(`  keep ${key}: "${current}" is already set (pass --force to overwrite with "${value}")`);
      continue;
    }
    if (current !== value) data[key] = value;
  }
  if (errors.length) {
    console.error("\nCannot continue:\n  " + errors.join("\n  "));
    process.exitCode = 1;
    return;
  }

  // 3. Preview the loading per item.
  const after = { ...enquiry, ...data };
  console.log("\n--- Docket changes ---");
  if (Object.keys(data).length === 0) console.log("  (none)");
  for (const [k, v] of Object.entries(data)) console.log(`  ${k}: ${show(enquiry[k as "paymentTerms" | "inspection" | "pbg"])} -> ${v}`);
  console.log("\n--- Cost loading per item (before -> after) ---");
  for (const it of enquiry.items) {
    const pc = it.productCost !== null ? Number(it.productCost) : null;
    if (pc === null || !(pc > 0)) {
      console.log(`  ${show(it.itemName).slice(0, 50).padEnd(50)} | no product cost`);
      continue;
    }
    const b = computeCostLoading(enquiry, pc, tables);
    const a = computeCostLoading(after, pc, tables);
    console.log(
      `  ${show(it.itemName).slice(0, 50).padEnd(50)} | ${formatLoadingPct(b.loadingPct)} -> ${formatLoadingPct(a.loadingPct)}` +
        ` | cost ${show(it.cost)} | VA% ${show(it.vaPercent)} | QR ${show(it.quotedRate)} | validation ${show(it.validation)}`,
    );
  }
  const frozen = isEnquiryFrozen(enquiry.apm, enquiry.offerPdfGeneratedAt);
  if (frozen) console.log("\nNOTE: docket is frozen (APM = Yes and offer PDF generated): terms will be written but costs will NOT be recalculated (same as the app).");
  if (enquiry.items.some((i) => i.validation === "Yes")) {
    console.log("NOTE: validated items keep their quoted rate; VA% absorbs the cost change (lib/rateAnchor.ts).");
  }

  // 4. Contract Review rows.
  const crRows = await tenderPrisma.contractReview.findMany({
    where: { contractNo: { equals: CONTRACT, mode: "insensitive" } },
    select: { id: true, contractNo: true, itemCode: true, poNo: true, orderList: true, paymentTerms: true },
  });
  console.log(`\n--- Contract Review ${CONTRACT}: ${crRows.length} row(s) ---`);
  if (crRows.length) {
    console.log(`  PO no: ${show(crRows.find((r) => r.poNo)?.poNo)} | PO attachments: ${show([...new Set(crRows.flatMap((r) => r.orderList))].join(", "))}`);
  }
  const crTargets = crRows.filter((r) => FORCE || isBlankTerm(r.paymentTerms));
  for (const r of crRows) {
    const will = crTargets.includes(r) && CONTRACT_PAYMENT_TERMS && r.paymentTerms !== CONTRACT_PAYMENT_TERMS;
    console.log(`  ${r.itemCode.padEnd(16)} paymentTerms ${show(r.paymentTerms)}${will ? ` -> ${CONTRACT_PAYMENT_TERMS}` : " (keep)"}`);
  }
  if (crRows.length && !CONTRACT_PAYMENT_TERMS) console.log("  (no --contract-payment-terms / --payment-terms given: Contract Review left as is)");

  if (!APPLY) {
    console.log("\nDry run: nothing written. Re-run with --apply to write.\n");
    return;
  }

  // 5. Write.
  if (Object.keys(data).length > 0) {
    await prisma.enquiry.update({ where: { id: enquiry.id }, data });
    console.log(`\nUpdated docket ${enquiry.docketNumber}: ${Object.keys(data).join(", ")}`);
    if (!frozen) {
      const items = await recalculateEnquiryItems(enquiry.id);
      console.log(`Recalculated ${items.length} item(s).`);
    }
  }
  const crIds = crTargets.filter((r) => CONTRACT_PAYMENT_TERMS && r.paymentTerms !== CONTRACT_PAYMENT_TERMS).map((r) => r.id);
  if (CONTRACT_PAYMENT_TERMS && crIds.length > 0) {
    const res = await tenderPrisma.contractReview.updateMany({
      where: { id: { in: crIds } },
      data: { paymentTerms: CONTRACT_PAYMENT_TERMS },
    });
    console.log(`Updated paymentTerms on ${res.count} Contract Review row(s) of ${CONTRACT}.`);
  }
  console.log("\nDone.\n");
}

main()
  .catch((e) => {
    console.error("Fix failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/prisma");
    const { prisma: tenderPrisma } = await import("@gmd/db-tender");
    await Promise.allSettled([prisma.$disconnect(), tenderPrisma.$disconnect()]);
  });
