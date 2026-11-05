"use client";

/** Right-hand drawer that edits the docket-level fields of one enquiry; Save writes only what changed. */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@gmd/ui/components/sheet";
import { Button } from "@gmd/ui/components/button";
import CellSelect, { optionsWithCurrent } from "./CellSelect";
import { parseAndValidateContractNumbers } from "@/lib/contractValidation";
import type { DropdownOptions, EnquiryData } from "@/lib/types";

type Draft = Record<string, string>;

// "-" is how Not Sent is shown and picked (the server stores it as "Not Sent").
const closureShown = (v?: string | null) => (v?.trim().toLowerCase() === "not sent" ? "-" : v || "");

function toDraft(e: EnquiryData): Draft {
  return {
    partyName: e.partyName || "",
    enquiryType: e.enquiryType || "",
    state: e.state || "",
    utility: e.utility || "",
    paymentTerms: e.paymentTerms || "",
    pbg: e.pbg || "",
    inspection: e.inspection || "",
    orderStatus: e.orderStatus || "",
    closureStatus: closureShown(e.closureStatus),
    duplicate: e.duplicate || "",
    duplicateOfDocket: e.duplicateOfDocket || "",
    senderEmail: e.senderEmail || "",
    contactNo: e.contactNo || "",
    selectedContractNo: (e.selectedContractNo ?? []).join(", "),
  };
}

function Form({
  enquiry,
  dropdownOptions,
  docketNumbers,
  deleting,
  onSave,
  onClose,
  onDeleteDuplicate,
}: {
  enquiry: EnquiryData;
  dropdownOptions: DropdownOptions;
  docketNumbers: string[];
  deleting: boolean;
  onSave: (id: string, changes: Record<string, string>, contracts: string[] | null) => Promise<void>;
  onClose: () => void;
  onDeleteDuplicate: (e: EnquiryData) => void;
}) {
  const initial = toDraft(enquiry);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [contractError, setContractError] = useState("");
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const select = (label: string, field: string, options: string[], extra?: { allowCustomValue?: boolean }) => (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <CellSelect
        placeholder="-"
        value={draft[field]}
        options={optionsWithCurrent(options, draft[field])}
        searchPlaceholder={`Search ${label.toLowerCase()}...`}
        onChange={set(field)}
        {...extra}
      />
    </label>
  );
  const text = (label: string, field: string) => (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <input
        value={draft[field]}
        onChange={(e) => set(field)(e.target.value)}
        className="h-7 rounded border border-input bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-blue-500"
      />
    </label>
  );

  const save = async () => {
    const changes: Record<string, string> = {};
    for (const k of Object.keys(draft)) {
      if (k !== "selectedContractNo" && draft[k] !== initial[k]) changes[k] = draft[k];
    }
    let contracts: string[] | null = null;
    if (draft.selectedContractNo !== initial.selectedContractNo) {
      const v = parseAndValidateContractNumbers(draft.selectedContractNo.toUpperCase());
      if (!v.isValid) {
        setContractError(v.error || "Invalid contract number");
        return;
      }
      contracts = v.contracts;
    }
    setContractError("");
    setSaving(true);
    try {
      await onSave(enquiry.id, changes, contracts);
      onClose();
    } catch {
      // the table already toasted the failure; keep the drawer open so nothing typed is lost
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>Edit {enquiry.docketNumber}</SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-3">
        {select("Party", "partyName", dropdownOptions.partyNames)}
        {select("Enquiry type", "enquiryType", dropdownOptions.enquiryTypes)}
        <div className="grid grid-cols-2 gap-3">
          {select("State", "state", dropdownOptions.states)}
          {select("Utility", "utility", dropdownOptions.utilities)}
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          Contract numbers (comma separated)
          <input
            value={draft.selectedContractNo}
            onChange={(e) => set("selectedContractNo")(e.target.value.toUpperCase())}
            className="h-7 rounded border border-input bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-blue-500"
          />
          {contractError && <span className="text-red-600 font-normal">{contractError}</span>}
          {enquiry.contractNo?.length > 0 && (
            <span className="flex flex-wrap gap-1 font-normal">
              {enquiry.contractNo.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    const cur = draft.selectedContractNo.split(",").map((s) => s.trim()).filter(Boolean);
                    if (!cur.includes(c)) set("selectedContractNo")([...cur, c].join(", "));
                  }}
                  className="rounded border border-border px-1 text-[10px] hover:bg-accent cursor-pointer"
                >
                  + {c}
                </button>
              ))}
            </span>
          )}
        </label>
        <div className="grid grid-cols-3 gap-3">
          {select("Payment", "paymentTerms", dropdownOptions.paymentTerms)}
          {select("PBG", "pbg", dropdownOptions.pbgs)}
          {select("Inspection", "inspection", dropdownOptions.inspections)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {select("Order status", "orderStatus", dropdownOptions.orderStatuses)}
          {select(
            "Closure status",
            "closureStatus",
            ["-", ...dropdownOptions.closureStatuses.filter((s) => s.trim().toLowerCase() !== "not sent")],
            { allowCustomValue: true },
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {select("Duplicate", "duplicate", ["Yes", "No"])}
          {draft.duplicate === "Yes" &&
            select(
              "Original docket",
              "duplicateOfDocket",
              docketNumbers.filter((d) => d !== enquiry.docketNumber),
            )}
        </div>
        {draft.duplicate === "Yes" && enquiry.duplicate === "Yes" && (
          <Button
            type="button"
            variant="outline"
            disabled={deleting || !enquiry.duplicateOfDocket}
            onClick={() => onDeleteDuplicate(enquiry)}
            className="self-start text-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete duplicate
          </Button>
        )}
        {text("Email", "senderEmail")}
        {text("Phone", "contactNo")}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </SheetFooter>
    </>
  );
}

export default function DocketEditDrawer({
  enquiry,
  ...rest
}: {
  enquiry: EnquiryData | null;
  dropdownOptions: DropdownOptions;
  docketNumbers: string[];
  deleting: boolean;
  onSave: (id: string, changes: Record<string, string>, contracts: string[] | null) => Promise<void>;
  onClose: () => void;
  onDeleteDuplicate: (e: EnquiryData) => void;
}) {
  return (
    <Sheet open={!!enquiry} onOpenChange={(o) => !o && rest.onClose()}>
      <SheetContent side="right" className="sm:max-w-md">
        {enquiry && <Form key={enquiry.id} enquiry={enquiry} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}
