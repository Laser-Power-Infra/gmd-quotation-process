"use client";

import { useEffect, useMemo, useRef } from "react";
import { shallowEqual } from "react-redux";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  clearEnquiryPageStale,
  hydrateEnquiryPage,
  loadEnquiryPage,
  selectAllEnquiries,
  selectEnquiryQuery,
  selectEnquirySummary,
} from "@/lib/enquiriesSlice";
import { setEnquiryStage } from "@/lib/enquiriesSlice";
import { setFilter } from "@/lib/filtersSlice";
import { setPage } from "@/lib/paginationSlice";
import { setAnalyticsOn, setAnalyticsSidebarCollapsed, setClosedBomIds } from "@/lib/uiSlice";
import type { DropdownOptions } from "@/lib/types";
import type { EnquiryPageResult } from "@/lib/enquiryQuery";
import { EMPTY_ENQUIRY_SUMMARY, enquiryFilterKey, enquiryQueryKey } from "@/lib/enquiryQuery";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EnquiryTable from "@/components/table/EnquiryTable";
import QuotationAnalyticsSidebar from "@/components/dashboard/QuotationAnalyticsSidebar";
import QuotationTotalValueCard from "@/components/dashboard/QuotationTotalValueCard";
import { formatIndianNumber } from "@/lib/formatCurrency";

interface DashboardContainerProps {
  initialPage: EnquiryPageResult;
  initialQueryKey: string;
  dropdownOptions: DropdownOptions;
  nextDocketNumber: string;
  autoSentDockets?: string[];
  autoPendingDockets?: string[];
}

export default function DashboardContainer({
  initialPage,
  initialQueryKey,
  dropdownOptions,
  nextDocketNumber,
  autoSentDockets,
  autoPendingDockets,
}: DashboardContainerProps) {
  const dispatch = useAppDispatch();

  const filters = useAppSelector((s) => s.filters);
  // The sidebar starts collapsed below 1600 px so the table fits; the user's own choice is remembered.
  const sidebarCollapsed = useAppSelector((s) => s.ui.isAnalyticsSidebarCollapsed);
  const sidebarApplied = useRef<boolean | null>(null); // what the rule set; only a different value is the user's choice
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("analytics-sidebar-collapsed"); } catch { /* blocked: use the width rule */ }
    const initial = saved === null ? window.innerWidth < 1600 : saved === "1";
    sidebarApplied.current = initial;
    dispatch(setAnalyticsSidebarCollapsed(initial));
  }, [dispatch]);
  useEffect(() => {
    if (sidebarApplied.current === null || !!sidebarCollapsed === sidebarApplied.current) return;
    sidebarApplied.current = !!sidebarCollapsed;
    try { localStorage.setItem("analytics-sidebar-collapsed", sidebarCollapsed ? "1" : "0"); } catch { /* not remembered */ }
  }, [sidebarCollapsed]);
  // Analytics switch: off = plain table. Read after mount so the server render stays "on".
  const analyticsOn = useAppSelector((s) => s.ui.analyticsOn);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("quotation-analytics-on"); } catch { /* blocked: stay on */ }
    if (saved === "0") dispatch(setAnalyticsOn(false));
  }, [dispatch]);
  const changeAnalytics = (on: boolean) => {
    dispatch(setAnalyticsOn(on));
    if (!on) dispatch(setEnquiryStage("")); // its tile is hidden, so nothing could un-click it
    try { localStorage.setItem("quotation-analytics-on", on ? "1" : "0"); } catch { /* not remembered */ }
  };
  const pageEnquiries = useAppSelector(selectAllEnquiries);
  const pageState = useAppSelector((s) => s.enquiries.page);
  const summary = useAppSelector(selectEnquirySummary) ?? initialPage.summary ?? EMPTY_ENQUIRY_SUMMARY;
  const query = useAppSelector(selectEnquiryQuery, shallowEqual);
  const queryKey = enquiryQueryKey(query);

  // Sidebar filter values synced with Redux filtersSlice
  const selectedPartyNames = filters.partyNames;
  const selectedUtilities = filters.utility;
  const selectedEnquiryTypes = filters.enquiryType;
  const selectedStates = filters.state;
  const selectedItemTypes = filters.itemType;
  const selectedSizes = filters.size;

  const setSelectedPartyNames = (v: string[]) => dispatch(setFilter({ field: "partyNames", value: v }));
  const setSelectedUtilities = (v: string[]) => dispatch(setFilter({ field: "utility", value: v }));
  const setSelectedEnquiryTypes = (v: string[]) => dispatch(setFilter({ field: "enquiryType", value: v }));
  const setSelectedStates = (v: string[]) => dispatch(setFilter({ field: "state", value: v }));
  const setSelectedItemTypes = (v: string[]) => dispatch(setFilter({ field: "itemType", value: v }));
  const setSelectedSizes = (v: string[]) => dispatch(setFilter({ field: "size", value: v }));

  const hasActiveAnalyticsFilters =
    selectedPartyNames.length > 0 ||
    selectedUtilities.length > 0 ||
    selectedEnquiryTypes.length > 0 ||
    selectedStates.length > 0 ||
    selectedItemTypes.length > 0 ||
    selectedSizes.length > 0;

  const clearAllAnalytics = () => {
    setSelectedPartyNames([]);
    setSelectedUtilities([]);
    setSelectedEnquiryTypes([]);
    setSelectedStates([]);
    setSelectedItemTypes([]);
    setSelectedSizes([]);
  };

  // Seed the page from the server render once. Later loads go through the action.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    dispatch(hydrateEnquiryPage({ ...initialPage, key: initialQueryKey }));
  }, [initialPage, initialQueryKey, dispatch]);

  // A new filter/sort/page combination loads exactly one page. Totals are only
  // recomputed when the filters change, not when paging or sorting.
  const loadedKeyRef = useRef<string | null>(initialQueryKey);
  const filterSigRef = useRef<string>("");
  const summarySigRef = useRef<string>("");
  useEffect(() => {
    // Selection scopes the cards/facets only, so it must not reset paging.
    const filterSig = enquiryFilterKey({ ...query, selectedEnquiryIds: [] });
    const summarySig = enquiryFilterKey(query);
    const filtersChanged = filterSigRef.current !== filterSig;
    const summaryChanged = summarySigRef.current !== summarySig;
    filterSigRef.current = filterSig;
    summarySigRef.current = summarySig;
    if (loadedKeyRef.current === queryKey) return;

    let effective = query;
    if (filtersChanged && query.page !== 1) {
      effective = { ...query, page: 1 };
      dispatch(setPage(1));
      // Claim the key we are about to load so the page reset does not fire a second request.
      loadedKeyRef.current = enquiryQueryKey(effective);
    } else {
      loadedKeyRef.current = queryKey;
    }
    dispatch(
      loadEnquiryPage({
        query: effective,
        includeSummary: filtersChanged || summaryChanged,
      }),
    );
  }, [queryKey, query, dispatch]);

  // Any mutation marks the page stale; refetch it so totals, filters and sort stay right.
  useEffect(() => {
    if (!pageState.stale) return;
    dispatch(clearEnquiryPageStale());
    dispatch(loadEnquiryPage({ query, includeSummary: true, background: true }));
  }, [pageState.stale, query, dispatch]);

  // Seed the closed-BOM set from the page's items (VerifyBom.cBatch = "C").
  const derivedClosedBomIds = useMemo(() => {
    const set = new Set<string>();
    for (const enquiry of pageEnquiries) {
      for (const item of enquiry.items ?? []) {
        for (const id of item.closedBomIds ?? []) {
          if (id) set.add(id);
        }
      }
    }
    return Array.from(set);
  }, [pageEnquiries]);

  useEffect(() => {
    dispatch(setClosedBomIds(derivedClosedBomIds));
  }, [derivedClosedBomIds, dispatch]);

  const formattedSum = formatIndianNumber(summary.totalValueGst, 2);
  const formattedExclSum = formatIndianNumber(summary.totalValueExclGst, 2);
  const formattedTotalCost = formatIndianNumber(summary.totalCost, 2);
  const totalVaPercent =
    summary.totalCost > 0
      ? ((summary.totalValueExclGst - summary.totalCost) / summary.totalCost) * 100
      : 0;
  const formattedTotalVa = summary.totalCost > 0 ? `${totalVaPercent.toFixed(2)}%` : "0.00%";
  const formattedTotalQuantity = formatIndianNumber(summary.totalQuantity);

  return (
    <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0 w-full overflow-hidden transition-all duration-300">
      {analyticsOn && <QuotationAnalyticsSidebar
        selectedPartyNames={selectedPartyNames}
        selectedUtilities={selectedUtilities}
        selectedEnquiryTypes={selectedEnquiryTypes}
        selectedStates={selectedStates}
        selectedItemTypes={selectedItemTypes}
        selectedSizes={selectedSizes}
        onPartyNamesChange={setSelectedPartyNames}
        onUtilitiesChange={setSelectedUtilities}
        onEnquiryTypesChange={setSelectedEnquiryTypes}
        onStatesChange={setSelectedStates}
        onItemTypesChange={setSelectedItemTypes}
        onSizesChange={setSelectedSizes}
        onClearAll={clearAllAnalytics}
        hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
        facetCounts={summary.facetCounts ?? {}}
      />}
      {/* overflow-y-auto, not hidden: on a short viewport the stat strip + header +
          stage tiles can exceed the height, and clipping them left no way to reach
          the table. The table keeps its own min height so it never collapses to zero. */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-y-auto overflow-x-hidden transition-all duration-300">
        {analyticsOn && <div className="shrink-0">
          <QuotationTotalValueCard
            formattedSum={formattedSum}
            formattedExclSum={formattedExclSum}
            formattedTotalCost={formattedTotalCost}
            formattedTotalVa={formattedTotalVa}
            formattedTotalQuantity={formattedTotalQuantity}
            filteredEnquiriesCount={summary.filteredEnquiries}
            analyticsItemsCount={summary.analyticsItems}
            hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
            activeFilterCount={
              selectedPartyNames.length +
              selectedUtilities.length +
              selectedEnquiryTypes.length +
              selectedStates.length +
              selectedItemTypes.length +
              selectedSizes.length
            }
          />
        </div>}
        <div className="shrink-0">
          <DashboardHeader
            nextDocketNumber={nextDocketNumber}
            dropdownOptions={dropdownOptions}
            initialSummary={initialPage.summary}
            analyticsOn={analyticsOn}
            onAnalyticsChange={changeAnalytics}
          />
        </div>
        <div className="bg-card rounded-lg border border-border shadow-sm flex flex-col flex-1 min-h-[26rem] overflow-hidden">
          <EnquiryTable
            dropdownOptions={dropdownOptions}
            autoSentDockets={autoSentDockets}
            autoPendingDockets={autoPendingDockets}
          />
        </div>
      </div>
    </div>
  );
}
