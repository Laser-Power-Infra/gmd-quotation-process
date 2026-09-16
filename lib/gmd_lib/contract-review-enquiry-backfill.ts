import type { PrismaClient } from "@/app/generated/prisma";

export function normalizeContractKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export interface ContractReviewEnquiryFields {
  state: string | null;
  utility: string | null;
  projectReference: string | null;
}

export interface ContractReviewEnquiryBackfillRow extends ContractReviewEnquiryFields {
  id: string;
  contractNo: string;
  previous: ContractReviewEnquiryFields;
}

export interface ContractReviewEnquiryBackfillResult {
  matched: number;
  changed: number;
  unmatched: number;
  rows: ContractReviewEnquiryBackfillRow[];
}

// Builds the list of ContractReview rows whose State / Utility / Project
// Reference differ from the matching Enquiry (matched by contract number,
// where Enquiry.contractNo is a list of contract numbers). First enquiry wins
// when several share the same contract number.
export async function computeContractReviewEnquiryBackfill(
  prisma: PrismaClient,
): Promise<ContractReviewEnquiryBackfillResult> {
  const enquiries = await prisma.enquiry.findMany({
    select: {
      contractNo: true,
      state: true,
      utility: true,
      projectReference: true,
    },
  });

  const byContract = new Map<string, ContractReviewEnquiryFields>();
  for (const enquiry of enquiries) {
    for (const cn of enquiry.contractNo ?? []) {
      const key = normalizeContractKey(cn);
      if (!key || byContract.has(key)) continue;
      byContract.set(key, {
        state: enquiry.state,
        utility: enquiry.utility,
        projectReference: enquiry.projectReference,
      });
    }
  }

  const reviewRows = await prisma.contractReview.findMany({
    select: {
      id: true,
      contractNo: true,
      state: true,
      utility: true,
      projectReference: true,
    },
  });

  const rows: ContractReviewEnquiryBackfillRow[] = [];
  let matched = 0;
  for (const row of reviewRows) {
    const match = byContract.get(normalizeContractKey(row.contractNo));
    if (!match) continue;
    matched++;
    const previous: ContractReviewEnquiryFields = {
      state: row.state ?? null,
      utility: row.utility ?? null,
      projectReference: row.projectReference ?? null,
    };
    const same =
      previous.state === (match.state ?? null) &&
      previous.utility === (match.utility ?? null) &&
      previous.projectReference === (match.projectReference ?? null);
    if (same) continue;
    rows.push({
      id: row.id,
      contractNo: row.contractNo,
      previous,
      state: match.state,
      utility: match.utility,
      projectReference: match.projectReference,
    });
  }

  return {
    matched,
    changed: rows.length,
    unmatched: reviewRows.length - matched,
    rows,
  };
}

export async function applyContractReviewEnquiryBackfill(
  prisma: PrismaClient,
  rows: ContractReviewEnquiryBackfillRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let applied = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.contractReview.update({
          where: { id: row.id },
          data: {
            state: row.state,
            utility: row.utility,
            projectReference: row.projectReference,
          },
        }),
      ),
    );
    applied += chunk.length;
  }
  return applied;
}
