"use client";

import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import { PurchasePage } from "@gmd/purchase/v2";
import type { PurchaseV2Actions } from "@gmd/purchase/po-columns";
import { clearFilters, setColumnSearch } from "@gmd/physical-stock/state";

/** Host wrapper: owns the cross-page links the package cannot know about. */
export default function PurchaseV2({ actions }: { actions: PurchaseV2Actions }) {
  const router = useRouter();
  const dispatch = useDispatch();
  return (
    <PurchasePage
      actions={actions}
      onItemClick={(itemCode) => {
        // Physical Stock keeps its filters in the shared store: land there already narrowed to this ERP code.
        dispatch(clearFilters());
        dispatch(setColumnSearch({ key: "erp_code", value: itemCode }));
        router.push("/physical_stock");
      }}
      onContractClick={(contract) => router.push(`/contract_review?search=${encodeURIComponent(contract)}`)}
    />
  );
}
