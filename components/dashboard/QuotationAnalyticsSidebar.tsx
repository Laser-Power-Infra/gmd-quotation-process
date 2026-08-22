"use client";

import { useMemo, useState } from "react";
import { useAppSelector } from "@/lib/hooks";
import { selectAllEnquiries, selectAllItems } from "@/lib/enquiriesSlice";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import MultiSelectFilter from "@/components/table/MultiSelectFilter";
import { X, Filter, IndianRupee } from "lucide-react";

function sortStrings(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export default function QuotationAnalyticsSidebar() {
  const enquiries = useAppSelector(selectAllEnquiries);
  const allItems = useAppSelector(selectAllItems);

  const [selectedPartyNames, setSelectedPartyNames] = useState<string[]>([]);
  const [selectedUtilities, setSelectedUtilities] = useState<string[]>([]);
  const [selectedEnquiryTypes, setSelectedEnquiryTypes] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  // All unique options (static) derived from current enquiries
  const allOptions = useMemo(() => {
    const partySet = new Set<string>();
    const utilitySet = new Set<string>();
    const typeSet = new Set<string>();
    const stateSet = new Set<string>();
    for (const e of enquiries) {
      if (e.partyName) partySet.add(e.partyName);
      if (e.utility) utilitySet.add(e.utility);
      if (e.enquiryType) typeSet.add(e.enquiryType);
      if (e.state) stateSet.add(e.state);
    }
    return {
      parties: sortStrings([...partySet]),
      utilities: sortStrings([...utilitySet]),
      enquiryTypes: sortStrings([...typeSet]),
      states: sortStrings([...stateSet]),
    };
  }, [enquiries]);

  // Cascaded options: for each field, exclude its own filter when computing availability,
  // but include the other 3 filters — symmetric cascading
  const cascaded = useMemo(() => {
    // helper: does enquiry pass filters except the one field we are computing?
    const getCascadedFor = (exclude: "party" | "utility" | "enquiryType" | "state"): string[] => {
      const filtered = enquiries.filter((e) => {
        if (exclude !== "party" && selectedPartyNames.length > 0 && !selectedPartyNames.includes(e.partyName)) return false;
        if (exclude !== "utility" && selectedUtilities.length > 0 && !selectedUtilities.includes(e.utility ?? "")) return false;
        if (exclude !== "enquiryType" && selectedEnquiryTypes.length > 0 && !selectedEnquiryTypes.includes(e.enquiryType ?? "")) return false;
        if (exclude !== "state" && selectedStates.length > 0 && !selectedStates.includes(e.state ?? "")) return false;
        return true;
      });

      const set = new Set<string>();
      for (const e of filtered) {
        let val: string | null | undefined;
        if (exclude === "party") val = e.partyName;
        else if (exclude === "utility") val = e.utility;
        else if (exclude === "enquiryType") val = e.enquiryType;
        else val = e.state;
        if (val) set.add(val);
      }
      return sortStrings([...set]);
    };

    return {
      parties: getCascadedFor("party"),
      utilities: getCascadedFor("utility"),
      enquiryTypes: getCascadedFor("enquiryType"),
      states: getCascadedFor("state"),
    };
  }, [enquiries, selectedPartyNames, selectedUtilities, selectedEnquiryTypes, selectedStates]);

  // Filtered enquiries by analytics sidebar (all 4 filters ANDed)
  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((e) => {
      if (selectedPartyNames.length > 0 && !selectedPartyNames.includes(e.partyName)) return false;
      if (selectedUtilities.length > 0 && !selectedUtilities.includes(e.utility ?? "")) return false;
      if (selectedEnquiryTypes.length > 0 && !selectedEnquiryTypes.includes(e.enquiryType ?? "")) return false;
      if (selectedStates.length > 0 && !selectedStates.includes(e.state ?? "")) return false;
      return true;
    });
  }, [enquiries, selectedPartyNames, selectedUtilities, selectedEnquiryTypes, selectedStates]);

  const filteredIds = useMemo(() => new Set(filteredEnquiries.map((e) => e.id)), [filteredEnquiries]);

  const analyticsItems = useMemo(() => {
    // Items whose parent enquiry matches analytics filters
    return allItems.filter((item) => filteredIds.has(item.enquiryId));
  }, [allItems, filteredIds]);

  const totalValueGstSum = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems) {
      const raw = item.totalValue;
      // empty / null / undefined / "0" treated as 0 per requirement
      if (raw == null || raw === "" || raw === "0") continue;
      const cleaned = String(raw).replace(/,/g, "").trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n)) sum += n;
    }
    return sum;
  }, [analyticsItems]);

  const formattedSum = useMemo(() => {
    // en-IN with 2 decimals, no currency symbol duplication (we show ₹ separately)
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalValueGstSum);
  }, [totalValueGstSum]);

  const hasActiveAnalyticsFilters =
    selectedPartyNames.length > 0 ||
    selectedUtilities.length > 0 ||
    selectedEnquiryTypes.length > 0 ||
    selectedStates.length > 0;

  const clearAll = () => {
    setSelectedPartyNames([]);
    setSelectedUtilities([]);
    setSelectedEnquiryTypes([]);
    setSelectedStates([]);
  };

  return (
    <aside className="w-full lg:w-[320px] xl:w-[340px] shrink-0 flex flex-col gap-3 lg:sticky lg:top-[64px] overflow-visible pr-0 lg:pr-1">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Analytics Filters</h2>
        </div>
        {hasActiveAnalyticsFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      {/* Party Name */}
      <Card size="sm" className="shadow-sm overflow-visible !overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">Party Name</CardTitle>
          <CardDescription className="text-[11px]">Filter by customer</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="Party Name"
            allLabel="All Parties"
            options={allOptions.parties}
            cascadedOptions={cascaded.parties}
            selected={selectedPartyNames}
            onChange={setSelectedPartyNames}
            searchPlaceholder="Search party..."
            panelClassName="w-72 z-[80]"
          />
        </CardContent>
      </Card>

      {/* Utility */}
      <Card size="sm" className="shadow-sm overflow-visible !overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">Utility</CardTitle>
          <CardDescription className="text-[11px]">Filter by utility</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="Utility"
            allLabel="All Utilities"
            options={allOptions.utilities}
            cascadedOptions={cascaded.utilities}
            selected={selectedUtilities}
            onChange={setSelectedUtilities}
            searchPlaceholder="Search utility..."
            panelClassName="w-72 z-[80]"
          />
        </CardContent>
      </Card>

      {/* Enquiry Type */}
      <Card size="sm" className="shadow-sm overflow-visible !overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">Enquiry Type</CardTitle>
          <CardDescription className="text-[11px]">Filter by enquiry type</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="Enquiry Type"
            allLabel="All Types"
            options={allOptions.enquiryTypes}
            cascadedOptions={cascaded.enquiryTypes}
            selected={selectedEnquiryTypes}
            onChange={setSelectedEnquiryTypes}
            searchPlaceholder="Search enquiry type..."
            panelClassName="w-72 z-[80]"
          />
        </CardContent>
      </Card>

      {/* State */}
      <Card size="sm" className="shadow-sm overflow-visible !overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">State</CardTitle>
          <CardDescription className="text-[11px]">Filter by state</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="State"
            allLabel="All States"
            options={allOptions.states}
            cascadedOptions={cascaded.states}
            selected={selectedStates}
            onChange={setSelectedStates}
            searchPlaceholder="Search state..."
            panelClassName="w-72 z-[80]"
          />
        </CardContent>
      </Card>

      {/* KPI Card - Total Value incl GST */}
      <Card size="sm" className="shadow-sm bg-gradient-to-br from-slate-50 to-white border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold flex items-center gap-1.5">
            <IndianRupee className="h-4 w-4 text-emerald-600" />
            Total Value (incl. GST)
          </CardTitle>
         
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tracking-tight text-foreground">₹ {formattedSum}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium">
              {filteredEnquiries.length} dockets
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium">
              {analyticsItems.length} items
            </span>
            {hasActiveAnalyticsFilters && (
              <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 font-medium">
                {selectedPartyNames.length + selectedUtilities.length + selectedEnquiryTypes.length + selectedStates.length} filters
              </span>
            )}
          </div>
          {!hasActiveAnalyticsFilters && (
            <p className="text-[11px] text-muted-foreground italic">Showing total for all dockets. Apply filters above to narrow.</p>
          )}
          {hasActiveAnalyticsFilters && analyticsItems.length === 0 && (
            <p className="text-[11px] text-amber-600">No items match current filter combination.</p>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
