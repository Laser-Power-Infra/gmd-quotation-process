"use client";

import React, { useState, useRef } from "react";
import { FileText, ChevronDown, ChevronRight } from "lucide-react";
import ActionsDropdown from "./ActionsDropdown";

interface Column {
  accessor: string;
  label: string;
  defaultWidth: number;
}

const COLUMNS: Column[] = [
  { accessor: "enquiryDate", label: "Enquiry Date", defaultWidth: 120 },
  { accessor: "docketNo", label: "Docket No", defaultWidth: 110 },
  { accessor: "partyName", label: "Party Name", defaultWidth: 200 },
  { accessor: "enquiryType", label: "Enquiry Type", defaultWidth: 100 },
  { accessor: "state", label: "State", defaultWidth: 80 },
  { accessor: "paymentTerms", label: "Payment Terms", defaultWidth: 100 },
  { accessor: "inspection", label: "Inspection", defaultWidth: 90 },
  { accessor: "pbg", label: "PBG", defaultWidth: 70 },
  { accessor: "utility", label: "Utility", defaultWidth: 80 },
  { accessor: "vaPercent", label: "VA%", defaultWidth: 70 },
  { accessor: "orderStatus", label: "Order Status", defaultWidth: 100 },
  { accessor: "itemName", label: "Item Name As Per Party", defaultWidth: 200 },
  { accessor: "quantity", label: "Quantity", defaultWidth: 110 },
  { accessor: "attachment", label: "Attachment", defaultWidth: 140 },
  { accessor: "actions", label: "Actions", defaultWidth: 90 },
];

interface EnquiryItem {
  id: string;
  itemName: string;
  quantity: any;
}

interface Enquiry {
  id: string;
  docketNumber: string;
  partyName: string;
  enquiryDate: Date;
  attachmentName: string | null;
  attachmentUrl: string | null;
  items: EnquiryItem[];
}

interface EnquiryTableProps {
  enquiries: Enquiry[];
}

// Helper to extract company name and branch
function parseParty(partyName: string) {
  const parts = partyName.split(",").map((s) => s.trim());
  return {
    company: parts[0] || "",
    branch: parts.slice(1).join(", ") || null,
  };
}

// Helper to generate initials for avatar
function getInitials(name: string) {
  const { company } = parseParty(name);
  const cleanName = company
    .replace(/[^a-zA-Z0-9\s]/g, "") // remove special chars
    .replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt)\b/gi, "")
    .trim();

  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return "EQ";
}

// Helper to format quantity with appropriate unit
function formatQuantity(itemName: string, quantity: any) {
  const qty = Number(quantity);
  const name = itemName.toLowerCase();
  let unit = "Units";

  if (
    name.includes("steel") ||
    name.includes("plates") ||
    name.includes("beam")
  ) {
    unit = "MT";
  } else if (
    name.includes("paint") ||
    name.includes("lubricant") ||
    name.includes("coating")
  ) {
    unit = "Ltr";
  } else if (name.includes("pipes")) {
    unit = "Meters";
  }

  return `${qty.toLocaleString()} ${unit}`;
}

export default function EnquiryTable({ enquiries }: EnquiryTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    COLUMNS.forEach((c) => { init[c.accessor] = c.defaultWidth; });
    return init;
  });

  const resizingColumnRef = useRef<string | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeMove = (e: MouseEvent) => {
    const accessor = resizingColumnRef.current;
    if (!accessor) return;
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(60, startWidthRef.current + diff);
    setColumnWidths((prev) => ({ ...prev, [accessor]: newWidth }));
  };

  const handleResizeEnd = () => {
    resizingColumnRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const handleResizeStart = (e: React.MouseEvent, accessor: string) => {
    e.preventDefault();
    resizingColumnRef.current = accessor;
    startXRef.current = e.clientX;
    startWidthRef.current = columnWidths[accessor];
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="flex-1 overflow-x-auto">
      <table className="w-full min-w-[1250px] border-collapse text-left border border-slate-200">
        <thead>
          <tr className="bg-slate-50/75">
            {COLUMNS.map((col, idx) => (
              <th
                key={col.accessor}
                className="py-3 px-4 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0 relative"
                style={{ width: columnWidths[col.accessor] }}
              >
                {col.label}
                {idx < COLUMNS.length - 1 && (
                  <div
                    className="column-resizer"
                    onMouseDown={(e) => handleResizeStart(e, col.accessor)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white">
          {enquiries.map((enquiry) => {
            const { company, branch } = parseParty(enquiry.partyName);
            const initials = getInitials(enquiry.partyName);
            const hasMultiple = enquiry.items.length > 1;
            const isExpanded = !!expanded[enquiry.id];
            const firstItem = enquiry.items[0];

            // Setup custom brand avatar styles
            let badgeBg = "bg-blue-50 text-blue-600 border border-blue-100";
            if (initials === "RE") {
              badgeBg = "bg-indigo-50 text-indigo-600 border border-indigo-100";
            } else if (initials === "AD") {
              badgeBg = "bg-sky-50 text-sky-600 border border-sky-100";
            } else if (initials === "LT") {
              badgeBg = "bg-emerald-50 text-emerald-600 border border-emerald-100";
            } else if (initials === "JS") {
              badgeBg = "bg-amber-50 text-amber-600 border border-amber-100";
            }

            return (
              <React.Fragment key={enquiry.id}>
                {/* Main Docket / First Item Row */}
                <tr className="hover:bg-slate-50/20 transition-colors">
                  <td
                    className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[0].accessor] }}
                  >
                    {new Date(enquiry.enquiryDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>

                  <td
                    className="py-3.5 px-4 text-xs font-semibold text-[#0f62fe] whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[1].accessor] }}
                  >
                    <div className="flex items-center">
                      {hasMultiple && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(enquiry.id)}
                          className="mr-1.5 inline-flex items-center justify-center p-0.5 hover:bg-slate-100 rounded text-slate-500 cursor-pointer focus:outline-none"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <span className="hover:underline cursor-pointer">
                        #{enquiry.docketNumber}
                      </span>
                    </div>
                  </td>

                  <td
                    className="py-3.5 px-4 whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[2].accessor] }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${badgeBg}`}
                      >
                        {initials}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-800">
                          {company}
                        </span>
                        {branch && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {branch}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {[3, 4, 5, 6, 7, 8, 9, 10].map((idx) => (
                    <td
                      key={COLUMNS[idx].accessor}
                      className="py-3.5 px-4 text-xs text-slate-400 border-r border-b border-slate-200 last:border-r-0"
                      style={{ width: columnWidths[COLUMNS[idx].accessor] }}
                    >-</td>
                  ))}

                  <td
                    className="py-3.5 px-4 text-xs text-slate-600 font-medium max-w-[200px] truncate border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[11].accessor] }}
                  >
                    {firstItem ? firstItem.itemName : "No items"}
                  </td>

                  <td
                    className="py-3.5 px-4 text-xs text-slate-600 font-semibold whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[12].accessor] }}
                  >
                    {firstItem ? formatQuantity(firstItem.itemName, firstItem.quantity) : "-"}
                  </td>

                  <td
                    className="py-3.5 px-4 text-xs whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                    style={{ width: columnWidths[COLUMNS[13].accessor] }}
                  >
                    {enquiry.attachmentName ? (
                      <a
                        href={enquiry.attachmentUrl || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#0f62fe] hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#0f62fe] stroke-[2]" />
                        {enquiry.attachmentName}
                      </a>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>

                  <td
                    className="py-3.5 px-4 text-right border-b border-slate-200"
                    style={{ width: columnWidths[COLUMNS[14].accessor] }}
                  >
                    {firstItem && (
                      <ActionsDropdown
                        item={{
                          id: firstItem.id,
                          itemName: firstItem.itemName,
                          quantity: firstItem.quantity,
                          enquiry: {
                            id: enquiry.id,
                            docketNumber: enquiry.docketNumber,
                            partyName: enquiry.partyName,
                            enquiryDate: enquiry.enquiryDate,
                            attachmentName: enquiry.attachmentName,
                            attachmentUrl: enquiry.attachmentUrl,
                          },
                        }}
                      />
                    )}
                  </td>
                </tr>

                {/* Additional Items Sub-Rows */}
                {isExpanded &&
                  hasMultiple &&
                  enquiry.items.slice(1).map((item) => (
                    <tr
                      key={item.id}
                      className="bg-slate-50/10 hover:bg-slate-50/20 transition-colors"
                    >
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((idx) => (
                        <td
                          key={COLUMNS[idx].accessor}
                          className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"
                          style={{ width: columnWidths[COLUMNS[idx].accessor] }}
                        ></td>
                      ))}

                      <td
                        className="py-3.5 px-4 text-xs text-slate-600 font-medium max-w-[200px] truncate border-r border-b border-slate-200 last:border-r-0"
                        style={{ width: columnWidths[COLUMNS[11].accessor] }}
                      >
                        {item.itemName}
                      </td>
                      <td
                        className="py-3.5 px-4 text-xs text-slate-600 font-semibold whitespace-nowrap border-r border-b border-slate-200 last:border-r-0"
                        style={{ width: columnWidths[COLUMNS[12].accessor] }}
                      >
                        {formatQuantity(item.itemName, item.quantity)}
                      </td>

                      <td
                        className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"
                        style={{ width: columnWidths[COLUMNS[13].accessor] }}
                      ></td>

                      <td
                        className="py-3.5 px-4 text-right border-b border-slate-200"
                        style={{ width: columnWidths[COLUMNS[14].accessor] }}
                      >
                        <ActionsDropdown
                          item={{
                            id: item.id,
                            itemName: item.itemName,
                            quantity: item.quantity,
                            enquiry: {
                              id: enquiry.id,
                              docketNumber: enquiry.docketNumber,
                              partyName: enquiry.partyName,
                              enquiryDate: enquiry.enquiryDate,
                              attachmentName: enquiry.attachmentName,
                              attachmentUrl: enquiry.attachmentUrl,
                            },
                          }}
                        />
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
