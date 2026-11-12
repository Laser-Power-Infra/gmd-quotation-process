"use client";

/**
 * The docket-level cells of a table row, as five stacked cells (Docket, Location,
 * Terms & Contract, Contact, Status). Values are text; edits happen in DocketEditDrawer.
 * Memoised: `actions` is a stable object, so a row re-renders only when its own data changes.
 */

import React, { memo, useRef } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import DocketAttachmentsCell from "@/components/attachment/DocketAttachmentsCell";
import StageAssignPopover from "./StageAssignPopover";
import { istDaysSince } from "@/lib/stageAgeing";
import { isInternalEmail } from "@/lib/enquiryEmailParty";
import { cn } from "@/lib/utils";
import type { EnquiryData } from "@/lib/types";

export interface DocketRowActions {
  toggleExpand: (id: string, currentExpanded: boolean) => void;
  applyVaRules: (id: string, docketNumber: string) => void;
  fieldChange: (id: string, field: string, value: string) => void;
  addAttachments: (e: React.ChangeEvent<HTMLInputElement>, id: string) => void;
  showIncomplete: () => void;
  edit: (id: string) => void;
}

const TD = "border-r border-b border-border align-top py-1 px-2.5 text-[11px]";
const BLANK_CHIP = "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300";

function copy(value: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(`Copied ${value}`),
    () => toast.error("Could not copy"),
  );
}

function Chip({ label, value }: { label: string; value?: string | null }) {
  return (
    <span
      title={`${label}: ${value || "not set"}`}
      className={cn(
        "inline-block max-w-full truncate rounded border px-1 text-[9px] leading-4",
        value ? "border-border bg-background text-foreground" : BLANK_CHIP,
      )}
    >
      {label} {value || "-"}
    </span>
  );
}

function DocketRowImpl({
  enquiry,
  itemCount,
  isExpanded,
  incomplete,
  closureAuto,
  actions,
}: {
  enquiry: EnquiryData;
  /** Items shown under the current filters. */
  itemCount: number;
  isExpanded: boolean;
  /** Items missing Type, MOC, Size, PN or Op Type. */
  incomplete: number;
  closureAuto: "sent" | "pending" | null;
  actions: DocketRowActions;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasMultiple = itemCount > 1;
  const contracts = enquiry.selectedContractNo ?? [];
  const closure = enquiry.closureStatus?.trim().toLowerCase() === "not sent" ? "" : enquiry.closureStatus;
  // A click on the text opens the drawer; buttons, links and inputs keep their own behaviour.
  // Clicks from portals (popovers, dialogs) bubble through React but are not inside the cell: ignore them.
  const open = (e: React.MouseEvent) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest("button,a,input,[role=combobox],[data-copy-text]")) return;
    actions.edit(enquiry.id);
  };

  return (
    <>
      <td
        onClick={open}
        style={{ left: 0 }}
        className={`${TD} sticky z-20 bg-background [tr:hover>&]:bg-muted shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)] cursor-pointer`}
      >
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0 whitespace-nowrap">
              {hasMultiple && (
                <button
                  type="button"
                  onClick={() => actions.toggleExpand(enquiry.id, isExpanded)}
                  className="inline-flex shrink-0 items-center justify-center p-0.5 hover:bg-muted rounded text-muted-foreground cursor-pointer"
                  aria-label={isExpanded ? "Collapse items" : "Expand items"}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              )}
              {/* Users copy the docket no: clicking the text selects it instead of opening the drawer. */}
              <span data-copy-text className="font-semibold text-[#0f62fe] dark:text-blue-300 shrink-0 whitespace-nowrap cursor-text select-all" title={enquiry.docketNumber}>{enquiry.docketNumber}</span>
              {incomplete > 0 && (
                <button
                  type="button"
                  onClick={actions.showIncomplete}
                  title={`${incomplete} item(s) missing Type, MOC, Size, PN or Op Type - click to filter`}
                  className="inline-flex shrink-0 items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-bold bg-red-600 text-white cursor-pointer"
                >
                  {incomplete}
                </button>
              )}
              {hasMultiple && !isExpanded && (
                <span title={`${itemCount - 1} more item(s)`} className="shrink-0 px-1 text-[9px] font-medium bg-blue-50 text-blue-600 rounded-full border border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/25">
                  +{itemCount - 1}
                </span>
              )}
              <span className="shrink-0 text-[10px] text-muted-foreground">
                · {new Date(enquiry.enquiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
                <span className="font-semibold" title="Days since enquiry">{istDaysSince(enquiry.enquiryDate)}d</span>
              </span>
              {enquiry.enquiryType && (
                <span className="min-w-0 truncate rounded border border-border px-1 text-[9px] leading-4 text-muted-foreground">
                  {enquiry.enquiryType}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-bold text-foreground truncate" title={enquiry.partyName}>
              {enquiry.partyName}
            </div>
          </div>
          <div className="flex shrink-0 flex-nowrap items-center gap-1">
            <button
              type="button"
              onClick={() => actions.applyVaRules(enquiry.id, enquiry.docketNumber)}
              title="Fetch CR rates and apply the VA% rules to this docket"
              className="inline-flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 cursor-pointer"
            >
              %
            </button>
            <StageAssignPopover enquiry={enquiry} onChange={(field, value) => actions.fieldChange(enquiry.id, field, value)} />
            <DocketAttachmentsCell
              compact
              docketNumber={enquiry.docketNumber}
              attachments={enquiry.attachments}
              onAddClick={() => fileRef.current?.click()}
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => actions.addAttachments(e, enquiry.id)}
            />
            {itemCount === 0 && (
              <span
                className="px-1 text-[9px] font-semibold bg-amber-50 text-amber-700 rounded-full border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25"
                title="Auto-created pending docket - add items to complete it"
              >
                Pending
              </span>
            )}
          </div>
        </div>
      </td>

      <td onClick={open} className={`${TD} cursor-pointer`}>
        <div className="truncate" title={enquiry.state ?? undefined}>
          {enquiry.state || <span className="text-muted-foreground">-</span>}
        </div>
        <div className="truncate text-muted-foreground" title={enquiry.utility ?? undefined}>
          {enquiry.utility || "-"}
        </div>
      </td>

      <td onClick={open} className={`${TD} cursor-pointer`}>
        <div className="truncate font-medium" title={contracts.join(", ")}>
          {contracts.length > 0 ? (
            contracts.join(", ")
          ) : /receiv/i.test(enquiry.orderStatus ?? "") ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            <Link href="/contract_review" className="text-[#0f62fe] dark:text-blue-300 hover:underline">
              + Contract
            </Link>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          <Chip label="Pay" value={enquiry.paymentTerms} />
          <Chip label="PBG" value={enquiry.pbg} />
          <Chip label="Insp" value={enquiry.inspection} />
        </div>
      </td>

      <td onClick={open} className={`${TD} cursor-pointer`}>
        {enquiry.senderEmail && isInternalEmail(enquiry.senderEmail) && (
          <span
            className="mr-1 px-1 text-[9px] font-semibold bg-slate-100 text-slate-600 rounded-full border border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/25"
            title="Internal (GMD / Laser) email address"
          >
            Internal
          </span>
        )}
        <button
          type="button"
          onClick={() => enquiry.senderEmail && copy(enquiry.senderEmail)}
          title={enquiry.senderEmail ? `${enquiry.senderEmail} - click to copy` : undefined}
          className="block max-w-full truncate text-left cursor-pointer hover:underline"
        >
          {enquiry.senderEmail || <span className="text-muted-foreground">-</span>}
        </button>
        <button
          type="button"
          onClick={() => enquiry.contactNo && copy(enquiry.contactNo)}
          title={enquiry.contactNo ? `${enquiry.contactNo} - click to copy` : undefined}
          className="block max-w-full truncate text-left text-muted-foreground cursor-pointer hover:underline"
        >
          {enquiry.contactNo || "-"}
        </button>
      </td>

      <td onClick={open} className={`${TD} cursor-pointer`}>
        <div className="truncate font-medium" title={enquiry.orderStatus ?? undefined}>
          {enquiry.orderStatus || <span className="text-muted-foreground">-</span>}
        </div>
        <div
          className={cn(
            "truncate",
            closureAuto === "sent" && "text-blue-600 font-semibold",
            closureAuto === "pending" && "text-amber-600 font-semibold",
            !closureAuto && "text-muted-foreground",
          )}
          title={
            closureAuto === "sent"
              ? "Auto-detected from thread attachments/OCR"
              : closureAuto === "pending"
                ? "No email found for this docket"
                : undefined
          }
        >
          {closure || "Not sent"}
        </div>
        {enquiry.duplicate === "Yes" && (
          <div className="truncate text-rose-600 dark:text-rose-300" title="Marked as a duplicate">
            Dup of {enquiry.duplicateOfDocket || "?"}
          </div>
        )}
      </td>
    </>
  );
}

export default memo(DocketRowImpl);
