import "dotenv/config";
import { prisma } from "../lib/prisma";
import { buildPartyMatcher, buildPartySearchText } from "../lib/docketPending";
import { contactFromMail, firstMessage, utilityEntries, utilityFromText } from "../lib/docketContact";
import { fillContactWithAi } from "../lib/docketContactAi";
import { aiFallbackEnabled } from "../schedular_function/docket-item-extraction";

// Fills blank Contact person / Phone / Utility on auto-created dockets from their source mail,
// with the same rules as docket creation. Only blank fields are filled.
// Dry run by default; --apply writes, --ai also asks the AI fallback for a phone / utility the
// rules miss (the contact person always comes from the signature), --docket <no> checks one docket.

const APPLY = process.argv.includes("--apply");
const AI = process.argv.includes("--ai");
const docketFlag = process.argv.indexOf("--docket");
const DOCKET = docketFlag > 0 ? process.argv[docketFlag + 1] : undefined;

const isBlank = (v: string | null | undefined) => !v || !v.trim() || v.trim() === "-";
const cell = (v: string, width: number) => (v.length > width ? `${v.slice(0, width - 1)}~` : v.padEnd(width));

/** contactPerson per docket id, or null while migration 20261118100000_enquiry_contact_person is not deployed. */
async function contactPersons(ids: string[]): Promise<Map<string, string | null> | null> {
  try {
    const rows = await prisma.enquiry.findMany({ where: { id: { in: ids } }, select: { id: true, contactPerson: true } });
    return new Map(rows.map((r) => [r.id, r.contactPerson]));
  } catch (e) {
    console.warn(`Enquiry.contactPerson is not readable (${e instanceof Error ? e.message.trim().split("\n").pop() : e}).`);
    console.warn("Migration 20261118100000_enquiry_contact_person is probably not deployed yet: treating Contact person as blank.\n");
    return null;
  }
}

async function main() {
  console.log(`=== BACKFILL DOCKET CONTACT [${APPLY ? "APPLY" : "DRY RUN"}] rules${AI ? " + AI" : ""} ===`);
  if (AI && !aiFallbackEnabled()) console.warn("--ai ignored: set AI_FALLBACK_ENABLED=true and OPENAI_API_KEY.");

  const utilityRows = await prisma.lookupOption.findMany({
    where: { type: "UTILITY", isActive: true },
    select: { value: true, code: true },
  });
  const matchUtility = buildPartyMatcher(utilityRows.map((r) => r.value));
  const entries = utilityEntries(utilityRows);

  // contactPerson is read separately so a not-yet-deployed column does not stop the dry run.
  const dockets = await prisma.enquiry.findMany({
    where: DOCKET ? { docketNumber: DOCKET } : { sourceThreadId: { not: null } },
    select: { id: true, docketNumber: true, senderEmail: true, contactNo: true, utility: true, sourceThreadId: true },
    orderBy: { createdAt: "asc" },
  });
  if (DOCKET && dockets.length === 0) {
    console.log(`${DOCKET}: no such docket.`);
    return;
  }
  const persons = await contactPersons(dockets.map((d) => d.id));
  if (APPLY && !persons) throw new Error("Deploy migration 20261118100000_enquiry_contact_person before --apply.");

  const threads = await prisma.docketQuotationThread.findMany({
    where: { threadId: { in: dockets.flatMap((d) => (d.sourceThreadId ? [d.sourceThreadId] : [])) } },
    select: { threadId: true, subject: true, body: true, bodyPreview: true, ocrText: true },
  });
  const threadById = new Map(threads.map((t) => [t.threadId, t]));

  type Fill = { id: string; contactPerson?: string; contactNo?: string; utility?: string };
  const fills: Fill[] = [];
  const counts = { complete: 0, noThread: 0, contactPerson: 0, contactNo: 0, utility: 0, stillBlank: 0 };
  console.log(`${cell("Docket", 18)} | ${cell("Contact person", 24)} | ${cell("Phone", 17)} | Utility   (· already set, ? not found)`);

  for (const d of dockets) {
    const current = { contactPerson: persons?.get(d.id) ?? null, phone: d.contactNo, utility: d.utility };
    const need = { contactPerson: isBlank(current.contactPerson), phone: isBlank(current.phone), utility: isBlank(current.utility) };
    if (!need.contactPerson && !need.phone && !need.utility) {
      counts.complete++;
      continue;
    }
    const thread = d.sourceThreadId ? threadById.get(d.sourceThreadId) : undefined;
    if (!thread) {
      counts.noThread++;
      console.log(`${cell(d.docketNumber, 18)} | no source mail${d.sourceThreadId ? " thread" : " (not auto-created)"}: fill it in the docket drawer`);
      continue;
    }

    const message = firstMessage(thread);
    const text = buildPartySearchText(thread);
    const rules = contactFromMail({ firstMessage: message, senderEmail: d.senderEmail });
    let found = {
      contactPerson: need.contactPerson ? rules.contactPerson : current.contactPerson,
      phone: need.phone ? rules.phone : current.phone,
      utility: need.utility ? (matchUtility(text) ?? utilityFromText(text, entries)) : current.utility,
    };
    if (AI) found = await fillContactWithAi({ subject: thread.subject, firstMessage: message, ocrText: thread.ocrText }, found, entries);

    const fill: Fill = { id: d.id };
    if (need.contactPerson && found.contactPerson) fill.contactPerson = found.contactPerson;
    if (need.phone && found.phone) fill.contactNo = found.phone;
    if (need.utility && found.utility) fill.utility = found.utility;
    const shown = (needed: boolean, value: string | undefined) => (!needed ? "·" : (value ?? "?"));
    console.log(
      `${cell(d.docketNumber, 18)} | ${cell(shown(need.contactPerson, fill.contactPerson), 24)} | ` +
        `${cell(shown(need.phone, fill.contactNo), 17)} | ${shown(need.utility, fill.utility)}`,
    );
    if (fill.contactPerson) counts.contactPerson++;
    if (fill.contactNo) counts.contactNo++;
    if (fill.utility) counts.utility++;
    if ((need.contactPerson && !fill.contactPerson) || (need.phone && !fill.contactNo) || (need.utility && !fill.utility)) {
      counts.stillBlank++;
    }
    if (fill.contactPerson || fill.contactNo || fill.utility) fills.push(fill);
  }

  console.log(`\nDockets checked: ${dockets.length} (already complete: ${counts.complete}, no source mail: ${counts.noThread})`);
  console.log(`Would fill: contact person ${counts.contactPerson}, phone ${counts.contactNo}, utility ${counts.utility} on ${fills.length} dockets`);
  console.log(`Still missing something after this run: ${counts.stillBlank + counts.noThread}`);

  if (!APPLY) {
    console.log("\nDRY RUN - re-run with --apply to write these changes.");
    return;
  }
  for (const f of fills) {
    await prisma.enquiry.update({
      where: { id: f.id },
      data: { contactPerson: f.contactPerson, contactNo: f.contactNo, utility: f.utility },
    });
  }
  console.log(`\nAPPLIED: ${fills.length} dockets updated.`);
}

// exitCode, not process.exit(): exiting while the AI client's sockets close crashes Node on Windows.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
