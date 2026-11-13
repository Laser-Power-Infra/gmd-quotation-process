/**
 * Contract Review "Docket mails": the docket follow-up mails (DocketQuotationThread) of one
 * contract. Matched on every request and never stored: the outside hourly sync owns that
 * table and rewrites docket_no, so a saved mapping would go stale. Read-only.
 */
import { prisma } from "@/lib/prisma";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import type { ContractMail } from "@gmd/contract-review/types";
import { normalizeContractKey } from "@/lib/contractDocketMatch";
import { parseThreadAttachments } from "@/lib/docketSnapshot";
import {
  docketSerialToken,
  isThreadOfDocket,
  poTokens,
  splitDocketList,
  tokenPattern,
} from "@/lib/docketThreadMatch";

// ContractMailsDialog (@gmd/contract-review) titles a full list "newest 200".
const MAX_MAILS = 200;

/** Newest first, at most 200. A blank or unknown contract has no mails. */
export async function findContractMails(contractNo: string): Promise<ContractMail[]> {
  const no = contractNo?.trim();
  // Blank would meet the sheet lines with no CONTRACT NO, and a blank search term matches every mail.
  if (!no) return [];
  const key = normalizeContractKey(no);
  const [lines, linked] = await Promise.all([
    // Case-insensitive, like addContractMailDoc.
    tenderPrisma.contractReview.findMany({
      where: { contractNo: { equals: no, mode: "insensitive" } },
      select: { docketNo: true, poNo: true },
    }),
    prisma.enquiry.findMany({
      where: { selectedContractNo: { isEmpty: false } },
      select: { docketNumber: true, selectedContractNo: true },
    }),
  ]);
  if (lines.length === 0) return [];

  const dockets = [
    ...new Set(
      [
        ...lines.flatMap((l) => splitDocketList(l.docketNo)),
        ...linked
          .filter((e) => e.selectedContractNo.some((c) => normalizeContractKey(c) === key))
          .map((e) => e.docketNumber),
      ]
        .map((d) => d.trim())
        // "NA" or a bare serial ("412") is no docket: it would pull in other contracts' mails.
        .filter((d) => d.length >= 6),
    ),
  ];

  // 1. Threads filed under one of the dockets: narrowed on the serial, then exact docket keys.
  const serials = [...new Set(dockets.map(docketSerialToken).filter(Boolean))];
  const filed =
    serials.length === 0
      ? []
      : await prisma.docketQuotationThread.findMany({
          where: { OR: serials.map((s) => ({ docketNo: { contains: s } })) },
          select: { id: true, docketNo: true },
        });

  // 2. Threads whose subject, attachment names or body name the contract, a PO number or a docket.
  //    One alternation pattern, so Postgres compiles and runs one regex per column, not one per term.
  const tokens = [...new Set([no, ...lines.flatMap((l) => poTokens(l.poNo)), ...dockets])];
  const pattern = tokenPattern(tokens);
  const mentioned = !tokens.length
    ? []
    : await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM docket_quotation_threads
        WHERE subject ~* ${pattern} OR attach_names::text ~* ${pattern} OR body ~* ${pattern}
        ORDER BY date DESC NULLS LAST, id DESC
        LIMIT ${MAX_MAILS}`;

  const ids = [
    ...filed.filter((t) => isThreadOfDocket(t.docketNo, dockets)).map((t) => t.id),
    ...mentioned.map((m) => Number(m.id)),
  ];
  const threads = await prisma.docketQuotationThread.findMany({
    where: { id: { in: ids } },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: MAX_MAILS,
    select: {
      threadId: true,
      subject: true,
      sender: true,
      date: true,
      actionTag: true,
      bodyPreview: true,
      attachNames: true,
      attachLinks: true,
    },
  });

  return threads.map((t) => ({
    threadId: t.threadId,
    subject: t.subject,
    sender: t.sender,
    date: t.date ? t.date.toISOString() : null,
    actionTag: t.actionTag,
    bodyPreview: t.bodyPreview ? t.bodyPreview.slice(0, 500) : null,
    attachments: parseThreadAttachments(t.attachNames, t.attachLinks).map(({ name, url }) => ({ name, url })),
    // Opens only in the Gmail account that synced the thread.
    gmailUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.threadId)}`,
  }));
}
