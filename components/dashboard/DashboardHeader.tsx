"use client";

import React, { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Filter, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import AddItemsDialog from "./AddItemsDialog";
import NewEnquiryDialog from "./NewEnquiryDialog";

interface DashboardHeaderProps {
  enquiries: { id: string; docketNumber: string; partyName: string }[];
}

export default function DashboardHeader({ enquiries }: DashboardHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchVal, setSearchVal] = useState(searchParams.get("search") || "");
  const [isPending, startTransition] = useTransition();

  const [isAddItemsOpen, setIsAddItemsOpen] = useState(false);
  const [isNewEnquiryOpen, setIsNewEnquiryOpen] = useState(false);

  // Debounce search update
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (searchVal) {
        params.set("search", searchVal);
      } else {
        params.delete("search");
      }
      // Reset page when search changes
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
            className="w-full rounded-md border border-border py-1.5 pr-4 pl-9 text-sm text-foreground placeholder-muted-foreground outline-none transition focus:border-slate-300 focus:ring-1 focus:ring-slate-200"
          />
          {isPending && (
            <div className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Button
          variant="outline"
          className="flex h-9 items-center gap-2 px-3 text-sm font-medium"
        >
          <Filter className="h-4 w-4" />
          More Filters
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>

        {/* Add Items Button */}
        <Button
          onClick={() => setIsAddItemsOpen(true)}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9]"
        >
          <Plus className="h-4 w-4" />
          Add Items
        </Button>

        {/* New Enquiry Button */}
        <Button
          onClick={() => setIsNewEnquiryOpen(true)}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9]"
        >
          <Plus className="h-4 w-4" />
          New Enquiry
        </Button>
      </div>

      {/* Dialog Modals */}
      <AddItemsDialog
        open={isAddItemsOpen}
        onOpenChange={setIsAddItemsOpen}
        enquiries={enquiries}
      />
      <NewEnquiryDialog
        open={isNewEnquiryOpen}
        onOpenChange={setIsNewEnquiryOpen}
      />
    </div>
  );
}
