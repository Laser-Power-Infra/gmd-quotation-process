"use client";

import React, { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/hooks";
import { openAddItemsDialog, openNewEnquiryDialog } from "@/lib/dialogsSlice";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchVal, setSearchVal] = useState(searchParams.get("search") || "");
  const [isPending, startTransition] = useTransition();
  const dispatch = useAppDispatch();

  // Debounce search update
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (searchVal) {
        params.set("search", searchVal);
      } else {
        params.delete("search");
      }
      params.delete("page");

      startTransition(() => {
        router.push(`?${params.toString()}`);
      });
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchVal, router]);

  return (
    <div className="flex flex-col gap-4 py-5 px-6 bg-card sm:flex-row sm:items-center sm:justify-between border-b border-border">
      <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
        <h1 className="text-xl font-bold text-foreground tracking-tight shrink-0">
          Recent Enquiries
        </h1>

        <div className="relative w-full max-w-xs">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Filter by Docket or Party..."
            className="w-full rounded-md border border-border py-1.5 pr-4 pl-9 text-sm text-foreground placeholder-muted-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring"
          />
          {isPending && (
            <div className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          )}
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
