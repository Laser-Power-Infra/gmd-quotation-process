import "dotenv/config";
import { prisma } from "../lib/prisma";
import { buildPartyMatcher, buildPartySearchText } from "../lib/docketPending";

// One-time fill of State / Utility on dockets in the "Pending only" list.
// Dry run by default; pass --apply to write. Only blank fields are filled.

const APPLY = process.argv.includes("--apply");
const SAMPLE_SIZE = 20;

const isBlank = (v: string | null | undefined) => !v || !v.trim();

async function main() {
  const [stateRows, utilityRows] = await Promise.all(
    (["STATE", "UTILITY"] as const).map((type) =>
      prisma.lookupOption.findMany({
        where: { type, isActive: true },
        select: { value: true },
      }),
    ),
  );
  const matchState = buildPartyMatcher(stateRows.map((r) => r.value));
  const matchUtility = buildPartyMatcher(utilityRows.map((r) => r.value));
  console.log(`Loaded ${stateRows.length} STATE and ${utilityRows.length} UTILITY lookup options.`);

  // Same Pending-only rule as lib/enquiry-query.ts: auto-created (has a thread),
  // no items, closure blank/Pending. Blank state/utility is checked below.
  const dockets = await prisma.enquiry.findMany({
    where: {
      sourceThreadId: { not: null },
      items: { none: {} },
      OR: [{ state: null }, { state: "" }, { utility: null }, { utility: "" }],
    },
    select: {
      id: true,
      docketNumber: true,
      state: true,
      utility: true,
      closureStatus: true,
      sourceThreadId: true,
    },
  });
  const pendingClosure = dockets.filter(
    (d) => isBlank(d.closureStatus) || d.closureStatus!.trim().toLowerCase() === "pending",
  );
  console.log(`Pending-only dockets with blank state or utility: ${pendingClosure.length}`);

  const threadIds = pendingClosure.map((d) => d.sourceThreadId!);
  const threads = await prisma.docketQuotationThread.findMany({
    where: { threadId: { in: threadIds } },
    select: { threadId: true, subject: true, body: true, bodyPreview: true, ocrText: true },
  });
  const threadById = new Map(threads.map((t) => [t.threadId, t]));

  type Update = { id: string; docketNumber: string; state?: string; utility?: string };
  const updates: Update[] = [];
  const stateCounts = new Map<string, number>();
  const utilityCounts = new Map<string, number>();
  const samples: string[] = [];
  let noThread = 0;

  for (const d of pendingClosure) {
    const thread = threadById.get(d.sourceThreadId!);
    if (!thread) {
      noThread++;
      continue;
    }
    const text = buildPartySearchText(thread);
    const update: Update = { id: d.id, docketNumber: d.docketNumber };

    if (isBlank(d.state)) {
      const state = matchState(text);
      if (state) {
        update.state = state;
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
      }
    }
    if (isBlank(d.utility)) {
      const utility = matchUtility(text);
      if (utility) {
        update.utility = utility;
        utilityCounts.set(utility, (utilityCounts.get(utility) || 0) + 1);
      }
    }

    if (update.state || update.utility) {
      updates.push(update);
      if (samples.length < SAMPLE_SIZE) {
        samples.push(
          `${d.docketNumber} | state=${update.state ?? "-"} | utility=${update.utility ?? "-"}`,
        );
      }
    }
  }

  console.log(`\nDockets to update: ${updates.length}`);
  console.log(`Dockets with no matching thread: ${noThread}`);
  console.log("\nState matches:");
  for (const [name, count] of [...stateCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}  ${name}`);
  }
  console.log("\nUtility matches:");
  for (const [name, count] of [...utilityCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}  ${name}`);
  }
  console.log("\nSample:");
  samples.forEach((s) => console.log(`  ${s}`));

  if (!APPLY) {
    console.log("\nDRY RUN - re-run with --apply to write these changes.");
    return;
  }

  for (const u of updates) {
    await prisma.enquiry.update({
      where: { id: u.id },
      data: {
        ...(u.state ? { state: u.state } : {}),
        ...(u.utility ? { utility: u.utility } : {}),
      },
    });
  }
  console.log(`\nAPPLIED: state/utility filled on ${updates.length} dockets.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
