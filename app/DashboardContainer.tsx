"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { hydrateFromServer, selectAllEnquiries, selectAllItems } from "@/lib/enquiriesSlice";
import { setFilter } from "@/lib/filtersSlice";
import type { EnquiryData, EnquiryItemData, DropdownOptions } from "@/lib/types";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EnquiryTable from "@/components/table/EnquiryTable";
import QuotationAnalyticsSidebar from "@/components/dashboard/QuotationAnalyticsSidebar";
import QuotationTotalValueCard from "@/components/dashboard/QuotationTotalValueCard";
import { enquiryPassesFilters, itemPassesFilters } from "@/lib/filterUtils";

interface DashboardContainerProps {
  enquiries: EnquiryData[];
  dropdownOptions: DropdownOptions;
  nextDocketNumber: string;
  enquiriesList: { id: string; docketNumber: string; partyName: string }[];
}

function extractUniqueStringValues(arr: any[], key: string): string[] {
  const vals = arr
    .map((item: any) => item[key])
    .filter((v: any) => v != null && v !== "");
  return [...new Set(vals.map(String))];
}

function mergeArrays(base: string[], additional: string[]): string[] {
  return [...new Set([...base, ...additional])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}

export default function DashboardContainer({
  enquiries,
  dropdownOptions,
  nextDocketNumber,
  enquiriesList,
}: DashboardContainerProps) {
  const dispatch = useAppDispatch();
  const storeEnquiries = useAppSelector(selectAllEnquiries);
  const storeItems = useAppSelector(selectAllItems);
  const filters = useAppSelector((s) => s.filters);
  const searchParams = useSearchParams();
  const globalSearch = (searchParams.get("search") || "").trim();

  // Sidebar filter values synced with Redux filtersSlice
  const selectedPartyNames = filters.partyNames;
  const selectedUtilities = filters.utility;
  const selectedEnquiryTypes = filters.enquiryType;
  const selectedStates = filters.state;

  const setSelectedPartyNames = (v: string[]) => dispatch(setFilter({ field: "partyNames", value: v }));
  const setSelectedUtilities = (v: string[]) => dispatch(setFilter({ field: "utility", value: v }));
  const setSelectedEnquiryTypes = (v: string[]) => dispatch(setFilter({ field: "enquiryType", value: v }));
  const setSelectedStates = (v: string[]) => dispatch(setFilter({ field: "state", value: v }));

  const hasActiveAnalyticsFilters =
    selectedPartyNames.length > 0 ||
    selectedUtilities.length > 0 ||
    selectedEnquiryTypes.length > 0 ||
    selectedStates.length > 0;

  const clearAllAnalytics = () => {
    setSelectedPartyNames([]);
    setSelectedUtilities([]);
    setSelectedEnquiryTypes([]);
    setSelectedStates([]);
  };

  // Use store data when hydrated, fallback to server prop for initial render
  const effectiveEnquiries = storeEnquiries.length > 0 ? storeEnquiries : enquiries;

  // Fully filtered enquiries matching both sidebar and table header filters
  const filteredEnquiries = useMemo(() => {
    return effectiveEnquiries.filter((enquiry) => {
      if (!enquiryPassesFilters(enquiry, filters, globalSearch)) return false;
      if (!enquiry.items || enquiry.items.length === 0) return true;
      return enquiry.items.some((item) => itemPassesFilters(item, filters));
    });
  }, [effectiveEnquiries, filters, globalSearch]);

  // Items of filtered enquiries that pass active item filters
  const analyticsItems = useMemo(() => {
    const items: EnquiryItemData[] = [];
    for (const e of filteredEnquiries) {
      if (!e.items) continue;
      for (const item of e.items) {
        if (itemPassesFilters(item, filters)) {
          items.push(item);
        }
      }
    }
    return items;
  }, [filteredEnquiries, filters]);

  const totalValueGstSum = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems as any[]) {
      const raw = (item as any).totalValue;
      if (raw == null || raw === "" || raw === "0") continue;
      const cleaned = String(raw).replace(/,/g, "").trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n)) sum += n;
    }
    return sum;
  }, [analyticsItems]);

  const formattedSum = useMemo(() => {
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalValueGstSum);
  }, [totalValueGstSum]);

  useEffect(() => {
    const allItems = enquiries.flatMap((e) => e.items as EnquiryItemData[]);
    dispatch(hydrateFromServer({ enquiries, items: allItems }));
  }, [enquiries, dispatch]);

  const mergedDropdownOptions = useMemo(() => {
    const allItems = enquiries.flatMap((e) => e.items);

    return {
      ...dropdownOptions,
      enquiryTypes: mergeArrays(dropdownOptions.enquiryTypes, extractUniqueStringValues(enquiries, "enquiryType")),
      states: mergeArrays(dropdownOptions.states, extractUniqueStringValues(enquiries, "state")),
      paymentTerms: mergeArrays(dropdownOptions.paymentTerms, extractUniqueStringValues(enquiries, "paymentTerms")),
      inspections: mergeArrays(dropdownOptions.inspections, extractUniqueStringValues(enquiries, "inspection")),
      pbgs: mergeArrays(dropdownOptions.pbgs, extractUniqueStringValues(enquiries, "pbg")),
      orderStatuses: mergeArrays(dropdownOptions.orderStatuses, extractUniqueStringValues(enquiries, "orderStatus")),
      pnRatings: mergeArrays(dropdownOptions.pnRatings, extractUniqueStringValues(allItems, "pnRating")),
      operationTypes: mergeArrays(dropdownOptions.operationTypes, extractUniqueStringValues(allItems, "operationType")),
      extensions: mergeArrays(dropdownOptions.extensions, extractUniqueStringValues(allItems, "extension")),
      bypasses: mergeArrays(dropdownOptions.bypasses, extractUniqueStringValues(allItems, "bypass")),
      vaPercents: mergeArrays(dropdownOptions.vaPercents, extractUniqueStringValues(allItems, "vaPercent")),
    };
  }, [enquiries, dropdownOptions]);

  return (
    <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0 w-full overflow-hidden transition-all duration-300">
      <QuotationAnalyticsSidebar
        selectedPartyNames={selectedPartyNames}
        selectedUtilities={selectedUtilities}
        selectedEnquiryTypes={selectedEnquiryTypes}
        selectedStates={selectedStates}
        onPartyNamesChange={setSelectedPartyNames}
        onUtilitiesChange={setSelectedUtilities}
        onEnquiryTypesChange={setSelectedEnquiryTypes}
        onStatesChange={setSelectedStates}
        onClearAll={clearAllAnalytics}
        hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden transition-all duration-300">
        <div className="shrink-0">
          <QuotationTotalValueCard
            formattedSum={formattedSum}
            filteredEnquiriesCount={filteredEnquiries.length}
            analyticsItemsCount={analyticsItems.length}
            hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
            activeFilterCount={
              selectedPartyNames.length +
              selectedUtilities.length +
              selectedEnquiryTypes.length +
              selectedStates.length
            }
          />
        </div>
        <div className="shrink-0">
          <DashboardHeader
            enquiries={enquiriesList}
            nextDocketNumber={nextDocketNumber}
            dropdownOptions={mergedDropdownOptions}
          />
        </div>
        <div className="bg-white rounded-lg border border-slate-100 overflow-hidden shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
          <EnquiryTable
            dropdownOptions={mergedDropdownOptions}
          />
        </div>
      </div>
    </div>
  );
}
