import "server-only";

import { prisma } from "@/lib/prisma";
import { SPEC_SEAT_PATTERN } from "@/lib/seatType";

/**
 * Docket spec = the OCR text of the attachments on the mail that created the docket
 * (Enquiry.sourceThreadId); hand-made dockets have none. Returns each docket's first seat
 * keyword, matched in Postgres so the OCR text never leaves the database.
 */
export async function docketSeatSpecs(enquiryIds: string[]): Promise<Map<string, string>> {
  if (enquiryIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; spec: string | null }[]>`
    SELECT e.id, array_to_string(regexp_match(t.ocr_text, ${SPEC_SEAT_PATTERN}, 'i'), '') AS spec
    FROM "Enquiry" e
    JOIN docket_quotation_threads t ON t.thread_id = e."sourceThreadId"
    WHERE e.id = ANY(${enquiryIds}::text[])
  `;
  return new Map(rows.filter((r) => r.spec).map((r) => [r.id, r.spec!]));
}
