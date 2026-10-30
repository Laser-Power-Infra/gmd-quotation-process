import "dotenv/config";
import { prisma } from "../lib/prisma";
import { extractEmailsFromValue } from "../lib/enquiryEmailParty";
import {
  normalizePoKey,
  recipientKey,
} from "../lib/pbg/reminder-recipients";

async function main() {
  const apply = process.argv.includes("--apply");
  const logs = await prisma.pbgReminderLog.findMany({
    where: {
      OR: [{ poNumber: null }, { recipientKey: null }],
    },
    select: {
      id: true,
      emails: true,
      poNumber: true,
      recipientKey: true,
      pbg: { select: { poNumber: true } },
    },
  });

  let updated = 0;
  let skippedNoPo = 0;
  let skippedNoEmail = 0;
  let unchanged = 0;

  for (const log of logs) {
    const poNumber = normalizePoKey(log.pbg?.poNumber ?? log.poNumber);
    const rKey =
      log.recipientKey ??
      recipientKey(extractEmailsFromValue(log.emails ?? ""));

    if (!poNumber) {
      skippedNoPo += 1;
      continue;
    }
    if (!rKey) {
      skippedNoEmail += 1;
      continue;
    }
    if (log.poNumber === poNumber && log.recipientKey === rKey) {
      unchanged += 1;
      continue;
    }

    if (apply) {
      await prisma.pbgReminderLog.update({
        where: { id: log.id },
        data: { poNumber, recipientKey: rKey },
      });
    }
    updated += 1;
  }

  console.log(`PBG reminder log backfill [${apply ? "APPLY" : "DRY RUN"}]`);
  console.log(`  candidates:      ${logs.length}`);
  console.log(`  updated:         ${updated}`);
  console.log(`  unchanged:       ${unchanged}`);
  console.log(`  skipped no PO:   ${skippedNoPo}`);
  console.log(`  skipped no email:${skippedNoEmail}`);
  if (!apply) console.log("  no changes written; pass --apply to write.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
