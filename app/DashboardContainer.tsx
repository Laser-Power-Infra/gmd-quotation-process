"use client";

import { useEffect } from "react";
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

  return (
    <>
      <DashboardHeader
        enquiries={enquiriesList}
        nextDocketNumber={nextDocketNumber}
        dropdownOptions={dropdownOptions}
      />
      <div className="bg-white rounded-lg border border-slate-100 overflow-hidden shadow-sm flex flex-col flex-1">
        <EnquiryTable dropdownOptions={dropdownOptions} />
      </div>
    </>
  );
}
