"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@gmd/ui/components/card";

interface QuotationTotalValueCardProps {
  formattedSum: string;
  formattedExclSum: string;
  formattedTotalCost: string;
  formattedTotalVa: string;
  formattedTotalQuantity: string;
  filteredEnquiriesCount: number;
  analyticsItemsCount: number;
  hasActiveAnalyticsFilters: boolean;
  activeFilterCount: number;
  className?: string;
}

// Uniform tile: label on one line, figure under it. The tiles share the row equally
// (flex-1 off a common basis) so the band spans the full width instead of bunching
// at the left; the label never wraps, which is what used to make the row ragged.
// Card 1 carries the scope pills on their own line underneath.
function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    // A real border, not the base Card's ring: rings paint outside the box and get
    // clipped by the dashboard's overflow-hidden columns.
    <Card
      size="sm"
      className="w-full sm:w-auto sm:flex-1 sm:basis-44 gap-0 rounded-lg border border-border bg-card py-2 shadow-none ring-0 [--card-spacing:--spacing(3)]"
    >
      <CardHeader className="py-0">
        <CardTitle className="truncate text-[10px] font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-0">
        <div className="truncate text-[15px] font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function QuotationTotalValueCard({
  formattedSum,
  formattedExclSum,
  formattedTotalCost,
  formattedTotalVa,
  formattedTotalQuantity,
  filteredEnquiriesCount,
  analyticsItemsCount,
  hasActiveAnalyticsFilters,
  activeFilterCount,
  className,
}: QuotationTotalValueCardProps) {
  const pill =
    "inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[9.5px] font-medium text-muted-foreground whitespace-nowrap";

  return (
    <div className={`flex flex-wrap items-stretch gap-2 ${className ?? ""}`}>
      <Stat label="Total Value (incl. GST)" value={`₹ ${formattedSum}`}>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className={pill}>{filteredEnquiriesCount.toLocaleString()} dockets</span>
          <span className={pill}>{analyticsItemsCount.toLocaleString()} items</span>
          {hasActiveAnalyticsFilters && (
            <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-px text-[9.5px] font-medium whitespace-nowrap text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
              {activeFilterCount} filters
            </span>
          )}
        </div>
      </Stat>

      <Stat label="Total Value (excl. GST)" value={`₹ ${formattedExclSum}`} />
      <Stat label="Total Cost" value={`₹ ${formattedTotalCost}`} />
      <Stat label="Total VA%" value={formattedTotalVa} />
      <Stat label="Total Quantity" value={formattedTotalQuantity} />
    </div>
  );
}
