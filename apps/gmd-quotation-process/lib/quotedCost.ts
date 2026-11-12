/**
 * Product cost, docket no and quoted rate from the Quotation app per (contract, item): the one
 * definition behind the Contract Review "COST FROM QUOTATION" / "DOCKET NO" / "QUOTED RATE"
 * backfill and the Sales Register's "Quoted GP %".
 *
 * The link is the enquiry's own selection: an EnquiryItem with the ERP item code counts for
 * every contract in its Enquiry.selectedContractNo, so an item is never attributed to a
 * contract its enquiry did not select. When several enquiries quote the same pair, the latest
 * (enquiryDate, else createdAt) wins; on a tie the first one read stays.
 */
import { prisma } from "@/lib/prisma";

const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();

/** Map key of one contract line: "CONTRACT||ITEM", each trimmed, single-spaced and upper-cased. */
export const quoteKey = (contractNo: string, itemCode: string) => normalize(contractNo) + "||" + normalize(itemCode);

/**
 * EnquiryItem.cost as text (null when blank), the winning enquiry's docket no and the item's
 * quoted rate, and that enquiry's time in ms.
 */
export type QuotedCost = { cost: string | null; docketNo: string; quotedRate: string | null; recency: number };

export type QuoteMatch = {
  erpItemCode: string | null;
  cost: unknown;
  quotedRate: string | null;
  enquiry: { selectedContractNo: string[] | null; enquiryDate: Date | null; createdAt: Date; docketNumber: string } | null;
};

/** The latest quote per `quoteKey`, from EnquiryItem rows. Pure: `latestByContractItem` loads the rows. */
export function pickLatestQuotes(matches: readonly QuoteMatch[]): Map<string, QuotedCost> {
  const bestByKey = new Map<string, QuotedCost>();
  for (const m of matches) {
    if (!m.erpItemCode || !m.enquiry) continue;
    const itemKey = normalize(m.erpItemCode);
    const recency =
      m.enquiry.enquiryDate?.getTime() ?? m.enquiry.createdAt.getTime() ?? 0;
    for (const cn of m.enquiry.selectedContractNo ?? []) {
      const key = normalize(cn) + "||" + itemKey;
      const prev = bestByKey.get(key);
      if (prev && prev.recency >= recency) continue;
      bestByKey.set(key, {
        cost: m.cost !== null && m.cost !== undefined ? String(m.cost) : null,
        docketNo: m.enquiry.docketNumber,
        quotedRate: m.quotedRate,
        recency,
      });
    }
  }
  return bestByKey;
}

/** Quoted cost for every contract that quoted any of `itemCodes`, keyed by `quoteKey`. */
export async function latestByContractItem(
  itemCodes: readonly (string | null | undefined)[],
): Promise<Map<string, QuotedCost>> {
  const codes = [
    ...new Set(
      itemCodes
        .filter((c): c is string => !!c && c.trim() !== "")
        .map(normalize),
    ),
  ];
  if (codes.length === 0) return new Map();

  const matches = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { in: codes } },
    select: {
      erpItemCode: true,
      cost: true,
      quotedRate: true,
      enquiry: {
        select: {
          selectedContractNo: true,
          enquiryDate: true,
          createdAt: true,
          docketNumber: true,
        },
      },
    },
  });
  return pickLatestQuotes(matches);
}
