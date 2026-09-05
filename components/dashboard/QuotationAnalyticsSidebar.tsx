"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { selectAllEnquiries } from "@/lib/enquiriesSlice";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import MultiSelectFilter from "@/components/table/MultiSelectFilter";
import { X, Filter, Search, Check } from "lucide-react";
import { enquiryPassesFilters, itemPassesFilters } from "@/lib/filterUtils";

function sortStrings(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

interface QuotationAnalyticsSidebarProps {
  selectedPartyNames: string[];
  selectedUtilities: string[];
  selectedEnquiryTypes: string[];
  selectedStates: string[];
  onPartyNamesChange: (v: string[]) => void;
  onUtilitiesChange: (v: string[]) => void;
  onEnquiryTypesChange: (v: string[]) => void;
  onStatesChange: (v: string[]) => void;
  onClearAll: () => void;
  hasActiveAnalyticsFilters: boolean;
}

export default function QuotationAnalyticsSidebar({
  selectedPartyNames,
  selectedUtilities,
  selectedEnquiryTypes,
  selectedStates,
  onPartyNamesChange,
  onUtilitiesChange,
  onEnquiryTypesChange,
  onStatesChange,
  onClearAll,
  hasActiveAnalyticsFilters,
}: QuotationAnalyticsSidebarProps) {
  const dispatch = useAppDispatch();
  const isCollapsed = useAppSelector((s) => s.ui.isAnalyticsSidebarCollapsed);
  const enquiries = useAppSelector(selectAllEnquiries);
  const filters = useAppSelector((s) => s.filters);
  const searchParams = useSearchParams();
  const globalSearch = (searchParams.get("search") || "").trim();

  const [stateSearchQuery, setStateSearchQuery] = useState("");

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

  // Compute party counts under all active filters except partyNames
  const partyCounts = useMemo(() => {
    const filtersWithoutParty = { ...filters, partyNames: [] };
    const filteredByOthers = enquiries.filter((e) => {
      if (!enquiryPassesFilters(e, filtersWithoutParty, globalSearch)) return false;
      if (!e.items || e.items.length === 0) return true;
      return e.items.some((item) => itemPassesFilters(item, filtersWithoutParty));
    });

    const counts: Record<string, number> = {};
    for (const e of filteredByOthers) {
      if (e.partyName) {
        counts[e.partyName] = (counts[e.partyName] || 0) + 1;
      }
    }
    return counts;
  }, [enquiries, filters, globalSearch]);

  // Compute state counts under all active filters except state
  const stateCounts = useMemo(() => {
    const filtersWithoutState = { ...filters, state: [] };
    const filteredByOthers = enquiries.filter((e) => {
      if (!enquiryPassesFilters(e, filtersWithoutState, globalSearch)) return false;
      if (!e.items || e.items.length === 0) return true;
      return e.items.some((item) => itemPassesFilters(item, filtersWithoutState));
    });

    const counts: Record<string, number> = {};
    for (const e of filteredByOthers) {
      if (e.state) {
        counts[e.state] = (counts[e.state] || 0) + 1;
      }
    }
    return counts;
  }, [enquiries, filters, globalSearch]);

  // Cascaded options: for each field, exclude its own filter when computing availability
  const cascaded = useMemo(() => {
    const getCascadedFor = (exclude: "party" | "utility" | "enquiryType" | "state"): string[] => {
      const fieldName = exclude === "party" ? "partyNames" : exclude;
      const customFilters = { ...filters, [fieldName]: [] };

      const filtered = enquiries.filter((e) => {
        if (!enquiryPassesFilters(e, customFilters, globalSearch)) return false;
        if (!e.items || e.items.length === 0) return true;
        return e.items.some((item) => itemPassesFilters(item, customFilters));
      });

      const set = new Set<string>();
      for (const e of filtered) {
        let val: string | null | undefined;
        if (exclude === "party") val = e.partyName;
        else if (exclude === "utility") val = (e as any).utility;
        else if (exclude === "enquiryType") val = (e as any).enquiryType;
        else val = (e as any).state;
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
  }, [enquiries, filters, globalSearch]);

  const visibleStateOptions = useMemo(() => {
    if (!stateSearchQuery.trim()) return allOptions.states;
    const q = stateSearchQuery.toLowerCase().trim();
    return allOptions.states.filter((s) => s.toLowerCase().includes(q));
  }, [allOptions.states, stateSearchQuery]);

  const clearAll = () => {
    onClearAll();
  };

  return (
    <aside
      className={`shrink-0 flex flex-col gap-2.5 overflow-y-auto max-h-full pr-1 transition-all duration-300 ease-in-out ${
        isCollapsed
          ? "lg:w-0 lg:max-w-0 lg:opacity-0 lg:-ml-4 lg:overflow-hidden lg:pointer-events-none hidden lg:flex"
          : "w-full lg:w-[300px] xl:w-[320px] opacity-100"
      }`}
    >
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
      <Card size="sm" className="shadow-sm overflow-visible overflow-visible!">
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
            onChange={onPartyNamesChange}
            counts={partyCounts}
            searchPlaceholder="Search party..."
            panelClassName="w-72 z-80"
          />
        </CardContent>
      </Card>

      {/* Utility */}
      <Card size="sm" className="shadow-sm overflow-visible overflow-visible!">
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
            onChange={onUtilitiesChange}
            searchPlaceholder="Search utility..."
            panelClassName="w-72 z-80"
          />
        </CardContent>
      </Card>

      {/* Enquiry Type */}
      <Card size="sm" className="shadow-sm overflow-visible overflow-visible!">
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
            onChange={onEnquiryTypesChange}
            searchPlaceholder="Search enquiry type..."
            panelClassName="w-72 z-80"
          />
        </CardContent>
      </Card>

      {/* State Cards Grid */}
      <Card size="sm" className="shadow-sm overflow-hidden">
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-[12px] font-semibold flex items-center gap-1.5">
              <span>State</span>
              {selectedStates.length > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-[#0f62fe] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {selectedStates.length}
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-[11px]">Filter by state</CardDescription>
          </div>
          {selectedStates.length > 0 && (
            <button
              type="button"
              onClick={() => onStatesChange([])}
              className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
            >
              Clear state
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {allOptions.states.length > 6 && (
            <div className="relative">
              <input
                type="text"
                placeholder="Search state..."
                value={stateSearchQuery}
                onChange={(e) => setStateSearchQuery(e.target.value)}
                className="w-full h-7 rounded border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
            {visibleStateOptions.map((st) => {
              const isSelected = selectedStates.includes(st);
              const count = stateCounts[st] || 0;
              const isAvailable = count > 0 || cascaded.states.includes(st);

              const toggleState = () => {
                if (isSelected) {
                  onStatesChange(selectedStates.filter((s) => s !== st));
                } else {
                  onStatesChange([...selectedStates, st]);
                }
              };

              return (
                <button
                  key={st}
                  type="button"
                  onClick={toggleState}
                  disabled={!isAvailable && !isSelected}
                  title={`${st} (${count} enquiries)`}
                  className={`flex items-center justify-between gap-1 p-2 rounded-md border text-left transition-all cursor-pointer ${
                    isSelected
                      ? "bg-blue-50 border-[#0f62fe] text-[#0f62fe] dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-300 font-semibold shadow-xs"
                      : isAvailable
                      ? "bg-background border-border text-foreground hover:bg-muted/70 hover:border-slate-300"
                      : "bg-muted/20 border-border/50 text-muted-foreground/50 opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span className="text-[11px] font-medium truncate flex-1 min-w-0">
                    {st}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1 ${
                      isSelected
                        ? "bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
