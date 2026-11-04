import React, { Suspense } from "react";
import DashboardContainer from "./DashboardContainer";
import { prisma } from "@/lib/prisma";
import { getActiveLookupValuesByType } from "@/lib/lookup";
import { lastClosureStatusSync } from "@/lib/closureStatusSync";
import { getFiscalPrefix, nextDocketSerials } from "@/lib/docketNumber";
import { fetchEnquiryPage } from "./actions/enquiryQuery";
import { emptyEnquiryQuery, enquiryQueryKey } from "@/lib/enquiryQuery";
import { loadCostLoadingTables } from "@/lib/costLoadingTables";

// The dashboard reads live data on every request.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Closure status is synced by the closure-status scheduler job, never on
  // render. The auto-detected dockets are only styling hints from its last run.
  const { sentDockets, pendingDockets } = lastClosureStatusSync() ?? {
    sentDockets: [] as string[],
    pendingDockets: [] as string[],
  };

  const initialQuery = emptyEnquiryQuery();
  // Only the first page is loaded here. Filters, paging and sorting re-run
  // through the same server action from the client.
  const [initialPage, enquiriesInFiscal, lookup, costLoading] = await Promise.all([
    fetchEnquiryPage(initialQuery),
    prisma.enquiry.findMany({
      where: { docketNumber: { startsWith: getFiscalPrefix(new Date()) } },
      select: { docketNumber: true },
    }),
    getActiveLookupValuesByType(),
    loadCostLoadingTables(),
  ]);

  const [nextDocketNumber] = nextDocketSerials(
    enquiriesInFiscal.map((e) => e.docketNumber),
    1,
    new Date(),
  );

  const sortOptions = (arr: string[]) =>
    [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const dropdownOptions = {
    partyNames: sortOptions(lookup.PARTY ?? []),
    enquiryTypes: sortOptions(lookup.ENQUIRY_TYPE ?? []),
    states: sortOptions(lookup.STATE ?? []),
    paymentTerms: sortOptions(lookup.PAYMENT_TERM ?? []),
    inspections: sortOptions(lookup.INSPECTION ?? []),
    pbgs: sortOptions(lookup.PBG ?? []),
    utilities: sortOptions(lookup.UTILITY ?? []),
    vaPercents: [],
    orderStatuses: sortOptions(lookup.ORDER_STATUS ?? []),
    closureStatuses: sortOptions(lookup.CLOSURE_STATUS ?? []),
    itemTypes: sortOptions(lookup.ITEM_TYPE ?? []),
    mocs: sortOptions(lookup.MOC ?? []),
    sizes: sortOptions(lookup.SIZE ?? []),
    pnRatings: sortOptions(lookup.PN_RATING ?? []),
    operationTypes: sortOptions(lookup.OPERATION_TYPE ?? []),
    extensions: sortOptions(lookup.EXTENSION ?? []),
    bypasses: sortOptions(lookup.BYPASS ?? []),
    others: sortOptions(lookup.OTHERS ?? ["flange", "gasket", "nut and bolt"]),
    deliverySchedules: sortOptions(lookup.DELIVERY ?? []),
    costLoading,
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background">
      <main className="flex-1 flex flex-col p-4 w-full gap-3 mx-auto min-h-0 overflow-hidden">
        <Suspense>
          <DashboardContainer
            initialPage={initialPage}
            initialQueryKey={enquiryQueryKey(initialQuery)}
            dropdownOptions={dropdownOptions}
            nextDocketNumber={nextDocketNumber}
            autoSentDockets={sentDockets}
            autoPendingDockets={pendingDockets}
          />
        </Suspense>
      </main>
    </div>
  );
}
