"use client";

import React, { useCallback } from "react";
import { Search, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { openAddItemsDialog, openNewEnquiryDialog } from "@/lib/dialogsSlice";
import { setFilter } from "@/lib/filtersSlice";
import { toggleAnalyticsSidebar } from "@/lib/uiSlice";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import AddItemsDialog from "./AddItemsDialog";
import NewEnquiryDialog from "./NewEnquiryDialog";

interface DashboardHeaderProps {
  enquiries: { id: string; docketNumber: string; partyName: string }[];
  nextDocketNumber: string;
  dropdownOptions: any;
}

export default function DashboardHeader({
  enquiries,
  nextDocketNumber,
  dropdownOptions,
}: DashboardHeaderProps) {
  const dispatch = useAppDispatch();
  const isCollapsed = useAppSelector((s) => s.ui.isAnalyticsSidebarCollapsed);
  const searchVal = useAppSelector((s) => s.filters.globalSearch);

  // Search filters the already-loaded rows client-side. It used to push ?search= and re-run
  // the dashboard's Prisma query, which refetched and re-hydrated the entire dataset.
  const commitSearch = useCallback(
    (val: string) => dispatch(setFilter({ field: "globalSearch", value: val })),
    [dispatch]
  );

  return (
    <div className="flex flex-col gap-4 py-3 px-6 bg-card sm:flex-row sm:items-center sm:justify-between border-b border-border shrink-0">
      <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => dispatch(toggleAnalyticsSidebar())}
            title={isCollapsed ? "Expand Analytics Filters" : "Collapse Analytics Filters"}
            className="p-1.5 rounded-md border border-border bg-background hover:bg-accent text-foreground transition-colors cursor-pointer"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 stroke-[1.75]" />
            ) : (
              <PanelLeftClose className="h-4 w-4 stroke-[1.75]" />
            )}
          </button>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Recent Enquiries
          </h1>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <DebouncedSearchInput
            value={searchVal}
            onCommit={commitSearch}
            placeholder="Filter by Docket or Party..."
            className="w-full rounded-md border border-border py-1.5 pr-4 pl-9 text-sm text-foreground placeholder-muted-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Button
          onClick={() => dispatch(openAddItemsDialog())}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Items
        </Button>

        <Button
          onClick={() => dispatch(openNewEnquiryDialog())}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Enquiry
        </Button>
      </div>

      <AddItemsDialog
        enquiries={enquiries}
      />
      <NewEnquiryDialog
        nextDocketNumber={nextDocketNumber}
        dropdownOptions={dropdownOptions}
      />
    </div>
  );
}
