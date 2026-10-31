"use client";

import { useMemo, useState } from "react";
import { useAppSelector } from "@/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@gmd/ui/components/card";
import MultiSelectFilter from "@/components/table/MultiSelectFilter";
import { X, Filter } from "lucide-react";
import { squish } from "@/lib/squish";

function sortStrings(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

interface QuotationAnalyticsSidebarProps {
  selectedPartyNames: string[];
  selectedUtilities: string[];
  selectedEnquiryTypes: string[];
  selectedStates: string[];
  selectedItemTypes: string[];
  selectedSizes: string[];
  onPartyNamesChange: (v: string[]) => void;
  onUtilitiesChange: (v: string[]) => void;
  onEnquiryTypesChange: (v: string[]) => void;
  onStatesChange: (v: string[]) => void;
  onItemTypesChange: (v: string[]) => void;
  onSizesChange: (v: string[]) => void;
  onClearAll: () => void;
  hasActiveAnalyticsFilters: boolean;
  /** Server summary counts (field → value → dockets) over the full filtered set. */
  facetCounts: Record<string, Record<string, number>>;
}

export default function QuotationAnalyticsSidebar({
  selectedPartyNames,
  selectedUtilities,
  selectedEnquiryTypes,
  selectedStates,
  selectedItemTypes,
  selectedSizes,
  onPartyNamesChange,
  onUtilitiesChange,
  onEnquiryTypesChange,
  onStatesChange,
  onItemTypesChange,
  onSizesChange,
  onClearAll,
  hasActiveAnalyticsFilters,
  facetCounts,
}: QuotationAnalyticsSidebarProps) {
  const isCollapsed = useAppSelector((s) => s.ui.isAnalyticsSidebarCollapsed);
  const [stateSearchQuery, setStateSearchQuery] = useState("");

  // Options and counts come from the server summary: every filtered docket
  // (scoped to the table selection), each field skipping its own filter so the
  // lists cascade. Selected values stay listed so they can still be cleared.
  const fields = useMemo(() => {
    const build = (key: string, selected: string[]) => {
      const counts = facetCounts[key] ?? {};
      const available = sortStrings(Object.keys(counts));
      return { counts, available, options: sortStrings([...new Set([...available, ...selected])]) };
    };
    return {
      parties: build("partyNames", selectedPartyNames),
      utilities: build("utility", selectedUtilities),
      enquiryTypes: build("enquiryType", selectedEnquiryTypes),
      states: build("state", selectedStates),
      itemTypes: build("itemType", selectedItemTypes),
      sizes: build("size", selectedSizes),
    };
  }, [facetCounts, selectedPartyNames, selectedUtilities, selectedEnquiryTypes, selectedStates, selectedItemTypes, selectedSizes]);

  const visibleStateOptions = useMemo(() => {
    if (!stateSearchQuery.trim()) return fields.states.options;
    const q = squish(stateSearchQuery);
    return fields.states.options.filter((s) => squish(s).includes(q));
  }, [fields.states.options, stateSearchQuery]);

  const clearAll = () => {
    onClearAll();
  };

  return (
    <aside
      className={`shrink-0 flex flex-col gap-2.5 overflow-y-auto max-h-full pr-1 transition-all duration-300 ease-in-out ${
        isCollapsed
          ? "lg:w-0 lg:max-w-0 lg:opacity-0 lg:-ml-4 lg:overflow-hidden lg:pointer-events-none hidden lg:flex"
          : "w-full lg:w-75 xl:w-[320px] opacity-100"
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
            className="text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:underline cursor-pointer flex items-center gap-1"
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
            options={fields.parties.options}
            cascadedOptions={fields.parties.available}
            selected={selectedPartyNames}
            onChange={onPartyNamesChange}
            counts={fields.parties.counts}
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
            options={fields.utilities.options}
            cascadedOptions={fields.utilities.available}
            counts={fields.utilities.counts}
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
            options={fields.enquiryTypes.options}
            cascadedOptions={fields.enquiryTypes.available}
            counts={fields.enquiryTypes.counts}
            selected={selectedEnquiryTypes}
            onChange={onEnquiryTypesChange}
            searchPlaceholder="Search enquiry type..."
            panelClassName="w-72 z-80"
          />
        </CardContent>
      </Card>

      {/* Item Type */}
      <Card size="sm" className="shadow-sm overflow-visible overflow-visible!">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">Item Type</CardTitle>
          <CardDescription className="text-[11px]">Filter by item type</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="Item Type"
            allLabel="All Item Types"
            options={fields.itemTypes.options}
            cascadedOptions={fields.itemTypes.available}
            selected={selectedItemTypes}
            onChange={onItemTypesChange}
            counts={fields.itemTypes.counts}
            includeBlank
            searchPlaceholder="Search item type..."
            panelClassName="w-72 z-80"
          />
        </CardContent>
      </Card>

      {/* Size */}
      <Card size="sm" className="shadow-sm overflow-visible overflow-visible!">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold">Size</CardTitle>
          <CardDescription className="text-[11px]">Filter by size</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelectFilter
            label="Size"
            allLabel="All Sizes"
            options={fields.sizes.options}
            cascadedOptions={fields.sizes.available}
            selected={selectedSizes}
            onChange={onSizesChange}
            counts={fields.sizes.counts}
            includeBlank
            searchPlaceholder="Search size..."
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
                <span className="inline-flex items-center justify-center rounded-full bg-[#0f62fe] dark:bg-blue-500/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
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
              className="text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:underline cursor-pointer"
            >
              Clear state
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {fields.states.options.length > 6 && (
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
              const count = fields.states.counts[st] || 0;
              const isAvailable = count > 0;

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
                      ? "bg-blue-50 border-[#0f62fe] text-[#0f62fe] dark:bg-blue-500/10 dark:border-blue-500 dark:text-blue-300 font-semibold shadow-xs"
                      : isAvailable
                      ? "bg-background border-border text-foreground hover:bg-muted/70 hover:border-muted-foreground/40"
                      : "bg-muted/20 border-border/50 text-muted-foreground/50 opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span className="text-[11px] font-medium truncate flex-1 min-w-0">
                    {st}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1 ${
                      isSelected
                        ? "bg-blue-200 text-blue-900 dark:bg-blue-500/25 dark:text-blue-200"
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
