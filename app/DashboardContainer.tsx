"use client";

import { useEffect, useMemo } from "react";
import { useAppDispatch } from "@/lib/hooks";
import { hydrateFromServer } from "@/lib/enquiriesSlice";
import type { EnquiryData, EnquiryItemData, DropdownOptions } from "@/lib/types";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EnquiryTable from "@/components/table/EnquiryTable";

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
    <>
      <DashboardHeader
        enquiries={enquiriesList}
        nextDocketNumber={nextDocketNumber}
        dropdownOptions={mergedDropdownOptions}
      />
      <div className="bg-white rounded-lg border border-slate-100 overflow-hidden shadow-sm flex flex-col flex-1">
        <EnquiryTable
          dropdownOptions={mergedDropdownOptions}
        />
      </div>
    </>
  );
}
