/**
 * Scheduled pending-docket dedupe.
 *
 * Runs as the second step of the hourly `docket-creation` job: dockets created
 * for the same mail (the ingestion can re-import a thread under a new Gmail
 * thread id) are detected from the thread snapshot and the pending copies are
 * deleted. Full rules and safety in `lib/docketDedupe.ts`.
 *
 * The mail thread is folded onto the keeper with `duplicateOfDocket`, which the
 * ingestion never clears. `docket-creation` skips marked threads, so a deleted
 * duplicate cannot come back on the next run.
 */

import { prisma } from "@/lib/prisma";
import {
  planPendingDocketDedupe,
  type DocketFacts,
  type ThreadFacts,
} from "@/lib/docketDedupe";

/** Hard safety cap per run; anything over is picked up by the next hour. */
const MAX_DELETIONS_PER_RUN = 50;

export interface PendingDocketDedupeOptions {
  dryRun?: boolean;
}

export interface DeletedDuplicate {
  docketNumber: string;
  keeper: string;
  threadIds: string[];
}

export interface PendingDocketDedupeResult {
  /** Every docket read. */
  scanned: number;
  /** Zero-item dockets read. */
  pending: number;
  /** Evidence groups with at least one deletion planned. */
  groups: number;
  planned: number;
  deleted: number;
  deferred: number;
  skippedWork: number;
  skippedAmbiguous: number;
  unresolved: number;
  failed: number;
  dryRun: boolean;
  deletions: DeletedDuplicate[];
}

export async function runPendingDocketDedupe(
  options: PendingDocketDedupeOptions = {},
): Promise<PendingDocketDedupeResult> {
  const dryRun = options.dryRun ?? false;

  const [docketRows, threadRows] = await Promise.all([
    prisma.enquiry.findMany({
      select: {
        id: true,
        docketNumber: true,
        partyName: true,
        createdAt: true,
        sourceThreadId: true,
        selectedContractNo: true,
        offerPdfGeneratedAt: true,
        emailApproved: true,
        emailSentBy: true,
        duplicate: true,
        duplicateOfDocket: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.docketQuotationThread.findMany({
      select: {
        threadId: true,
        docketNo: true,
        subject: true,
        sender: true,
        date: true,
        bodyPreview: true,
        attachNames: true,
        attachLinks: true,
      },
    }),
  ]);

  const pendingIds = docketRows
    .filter((docket) => docket._count.items === 0)
    .map((docket) => docket.id);

  // Only zero-item dockets are deleted, so only they need attachment URLs to
  // resolve their source thread. Keepers resolve from sourceThreadId/docketNo.
  const attachmentRows = pendingIds.length
    ? await prisma.attachment.findMany({
        where: {
          enquiryId: { in: pendingIds },
          name: { not: { contains: "mail_snapshot" } },
        },
        select: { enquiryId: true, url: true },
      })
    : [];

  const urlsByEnquiry = new Map<string, string[]>();
  for (const attachment of attachmentRows) {
    const url = attachment.url?.trim();
    if (!url || !url.startsWith("http")) continue;
    const urls = urlsByEnquiry.get(attachment.enquiryId);
    if (urls) urls.push(url);
    else urlsByEnquiry.set(attachment.enquiryId, [url]);
  }

  const dockets: DocketFacts[] = docketRows.map((docket) => ({
    id: docket.id,
    docketNumber: docket.docketNumber,
    partyName: docket.partyName,
    createdAt: docket.createdAt,
    sourceThreadId: docket.sourceThreadId,
    items: docket._count.items,
    selectedContractNo: docket.selectedContractNo,
    offerPdfGeneratedAt: docket.offerPdfGeneratedAt,
    emailApproved: docket.emailApproved,
    emailSentBy: docket.emailSentBy,
    duplicate: docket.duplicate,
    duplicateOfDocket: docket.duplicateOfDocket,
    attachmentUrls: urlsByEnquiry.get(docket.id) ?? [],
  }));
  const threads: ThreadFacts[] = threadRows;

  const plan = planPendingDocketDedupe(dockets, threads, MAX_DELETIONS_PER_RUN);
  const planned = plan.groups.reduce((total, group) => total + group.deletes.length, 0);

  const result: PendingDocketDedupeResult = {
    scanned: dockets.length,
    pending: plan.pending,
    groups: plan.groups.length,
    planned,
    deleted: 0,
    deferred: plan.deferred,
    skippedWork: plan.skippedWork.length,
    skippedAmbiguous: plan.skippedAmbiguous.length,
    unresolved: plan.unresolved.length,
    failed: 0,
    dryRun,
    deletions: [],
  };

  if (dryRun) {
    for (const group of plan.groups) {
      console.log(
        `[docket-dedupe] DRY ${group.keeper.docketNumber} <- ` +
          `${group.deletes.map((d) => d.docketNumber).join(", ")} ` +
          `(${group.evidence.join("+")})`,
      );
    }
    console.log(
      `[docket-dedupe] dryRun pending=${result.pending} groups=${result.groups} ` +
        `wouldDelete=${planned} deferred=${result.deferred} ` +
        `skippedWork=${result.skippedWork} ambiguous=${result.skippedAmbiguous} ` +
        `unresolved=${result.unresolved}`,
    );
    return result;
  }

  for (const group of plan.groups) {
    try {
      // Carry the deleted docket's durable mail link to the keeper when the
      // keeper has none. The update runs after the deletes so the unique
      // `sourceThreadId` is free.
      const keeperLink = group.keeper.sourceThreadId
        ? null
        : (group.deletes.find((docket) => docket.sourceThreadId)?.sourceThreadId ?? null);

      await prisma.$transaction([
        prisma.docketQuotationThread.updateMany({
          where: { threadId: { in: group.threadIds } },
          data: {
            docketNo: group.keeper.docketNumber,
            pendingDocket: false,
            aiIsNewDocket: false,
            duplicateOfDocket: group.keeper.docketNumber,
          },
        }),
        ...group.deletes.map((docket) =>
          prisma.enquiry.delete({ where: { id: docket.id } }),
        ),
        ...(keeperLink
          ? [
              prisma.enquiry.update({
                where: { id: group.keeper.id },
                data: { sourceThreadId: keeperLink },
              }),
            ]
          : []),
      ]);

      for (const docket of group.deletes) {
        result.deletions.push({
          docketNumber: docket.docketNumber,
          keeper: group.keeper.docketNumber,
          threadIds: group.threadIds,
        });
      }
      result.deleted += group.deletes.length;
      console.log(
        `[docket-dedupe] ${group.keeper.docketNumber} <- ` +
          `${group.deletes.map((d) => d.docketNumber).join(", ")} ` +
          `(${group.evidence.join("+")}, threads=${group.threadIds.length})`,
      );
    } catch (error) {
      result.failed++;
      console.error(
        `[docket-dedupe] failed for keeper ${group.keeper.docketNumber}:`,
        error,
      );
    }
  }

  console.log(
    `[docket-dedupe] pending=${result.pending} groups=${result.groups} ` +
      `deleted=${result.deleted}/${result.planned} deferred=${result.deferred} ` +
      `skippedWork=${result.skippedWork} ambiguous=${result.skippedAmbiguous} ` +
      `unresolved=${result.unresolved} failed=${result.failed}`,
  );

  return result;
}
