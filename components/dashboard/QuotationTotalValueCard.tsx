"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IndianRupee } from "lucide-react";

interface QuotationTotalValueCardProps {
  formattedSum: string;
  filteredEnquiriesCount: number;
  analyticsItemsCount: number;
  hasActiveAnalyticsFilters: boolean;
  activeFilterCount: number;
  className?: string;
}

export default function QuotationTotalValueCard({
  formattedSum,
  filteredEnquiriesCount,
  analyticsItemsCount,
  hasActiveAnalyticsFilters,
  activeFilterCount,
  className,
}: QuotationTotalValueCardProps) {
  return (
    <Card size="sm" className={`shadow-sm bg-gradient-to-br from-slate-50 to-white border-slate-200 shrink-0 w-full py-1 ${className ?? ""}`}>
      <CardHeader className="py-1 pb-0.5">
        <CardTitle className="text-[11px] font-semibold flex items-center gap-1">
          <IndianRupee className="h-3 w-3 text-emerald-600" />
          Total Value (incl. GST)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-row items-center justify-between gap-2 py-0.5">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-bold tracking-tight text-foreground">₹ {formattedSum}</span>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {filteredEnquiriesCount} dockets
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {analyticsItemsCount} items
          </span>
          {hasActiveAnalyticsFilters && (
            <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">
              {activeFilterCount} filters
            </span>
          )}
        </div>
        <div className="hidden sm:block text-[10px] leading-none">
          {!hasActiveAnalyticsFilters ? (
            <span className="text-muted-foreground italic">All dockets — apply filters to narrow.</span>
          ) : analyticsItemsCount === 0 ? (
            <span className="text-amber-600">No items match.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
