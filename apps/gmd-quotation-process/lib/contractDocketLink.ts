/**
 * Contract <-> docket linking shared by the Match button (app/actions/contractMatch.ts)
 * and the nightly docket-auto-link job. No server actions here: a job cannot call them.
 * Only the link is shared; writing contract rates stays a Match-button action.
 */
import { prisma } from "@/lib/prisma";
import { mergeContractNos, normalizeParty } from "@/lib/contractDocketMatch";

/** Dockets whose `normalizeParty` name is in `parties`, with what the ranking reads. */
export async function docketsOfParties(parties: Set<string>) {
  const heads = await prisma.enquiry.findMany({ select: { id: true, partyName: true } });
  const ids = heads.filter((h) => parties.has(normalizeParty(h.partyName))).map((h) => h.id);
  return prisma.enquiry.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, docketNumber: true, partyName: true, enquiryDate: true, selectedContractNo: true,
      items: { select: { id: true, erpItemCode: true, size: true, quantity: true } },
    },
  });
}

/**
 * Adds the contract(s) to the docket's Selected Contract No, merged with what the
 * docket carries right now, so an existing link is never replaced or removed.
 */
export async function linkContractsToDocket(enquiryId: string, contractNos: string[]) {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: { docketNumber: true, selectedContractNo: true },
  });
  const merged = mergeContractNos(enquiry.selectedContractNo, contractNos);
  // The line updateEnquiryFieldAction logged for this write, so log searches still find it.
  console.log(`[Server] updateEnquiryField enquiry=${enquiryId} field=selectedContractNo old="${enquiry.selectedContractNo}" new="${merged}"`);
  await prisma.enquiry.update({ where: { id: enquiryId }, data: { selectedContractNo: merged } });
  return { docketNumber: enquiry.docketNumber, selectedContractNo: merged };
}
