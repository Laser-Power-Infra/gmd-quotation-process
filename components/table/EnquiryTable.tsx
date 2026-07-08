"use client";

import React, { useState, useEffect, useRef } from "react";
import { FileText, ChevronDown, ChevronRight, Search, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ActionsDropdown from "./ActionsDropdown";
import Pagination from "./Pagination";
import { updateEnquiryFieldAction, updateItemFieldAction } from "@/app/actions";
// import { detectItemType } from "@/lib/itemTypeKeywords";
import { PARTY_NAMES } from "@/lib/partyNames";
import * as XLSX from "xlsx";

interface EnquiryItem {
  id: string;
  itemName: string;
  quantity: any;
  itemType: string | null;
  moc: string | null;
  size: string | null;
  pnRating: string | null;
  operationType: string | null;
  extension: string | null;
  bypass: string | null;
  productCost: any | null;
  costRefCode: string | null;
  cost: any | null;
  stockStatus: string | null;
  discount: any | null;
  quotedRate: string | null;
}

interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string | null;
  size: number | null;
}

interface Enquiry {
  id: string;
  docketNumber: string;
  partyName: string;
  enquiryDate: Date;
  enquiryType: string | null;
  state: string | null;
  paymentTerms: string | null;
  inspection: string | null;
  pbg: string | null;
  utility: string | null;
  vaPercent: number | null;
  orderStatus: string | null;
  attachments: Attachment[];
  items: EnquiryItem[];
}

interface DropdownOptions {
  enquiryTypes: string[];
  states: string[];
  paymentTerms: string[];
  inspections: string[];
  pbgs: string[];
  utilities: string[];
  vaPercents: string[];
  orderStatuses: string[];
  itemTypes: string[];
  mocs: string[];
  sizes: string[];
  pnRatings: string[];
  operationTypes: string[];
  extensions: string[];
  bypasses: string[];
}

interface EnquiryTableProps {
  enquiries: Enquiry[];
  dropdownOptions: DropdownOptions;
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

function formatQuantity(itemName: string, quantity: any) {
  const qty = Number(quantity);
  return qty.toLocaleString();
}

export default function EnquiryTable({ enquiries, dropdownOptions }: EnquiryTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Column filter states initialized with "All" for dropdown select menus
  const [filters, setFilters] = useState({
    enquiryDateFrom: "",
    enquiryDateTo: "",
    docketNumber: "",
    partyNames: [] as string[],
    enquiryType: "All",
    state: "All",
    paymentTerms: "All",
    inspection: "All",
    pbg: "All",
    utility: "",
    vaPercent: "",
    orderStatus: "All",
    itemName: "",
    quantity: "",
    itemType: "All",
    moc: "All",
    size: "All",
    pnRating: "All",
    operationType: "All",
    extension: "All",
    bypass: "All",
    productCost: "",
    costRefCode: "",
    cost: "",
    stockStatus: "",
    discount: "",
    quotedRate: "",
    attachment: "",
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset pagination to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Custom column widths state (expanded for 28 columns)
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({
    0: 260, // Enquiry Date
    1: 120, // Docket No
    2: 240, // Party Name
    3: 130, // Enquiry Type
    4: 100, // State
    5: 120, // Payment Terms
    6: 110, // Inspection
    7: 90,  // PBG
    8: 110, // Utility
    9: 90,  // VA%
    10: 130,// Order Status
    11: 220,// Item Name
    12: 110,// Quantity
    13: 130,// Item Type
    14: 100,// MOC
    15: 90, // Size
    16: 110,// PN Rating
    17: 130,// Operation Type
    18: 100,// Extension
    19: 95, // Bypass
    20: 110,// Product Cost
    21: 125,// Cost Ref Code
    22: 100,// Cost
    23: 110,// Stock Status
    24: 95, // Discount
    25: 120,// Quoted Rate
    26: 140,// Attachment
    27: 80, // Actions
  });

  const [isPartyFilterOpen, setIsPartyFilterOpen] = useState(false);
  const [partySearch, setPartySearch] = useState("");

  const hasActiveFilters = Object.values(filters).some((val) => {
    if (Array.isArray(val)) return val.length > 0;
    return val !== "" && val !== "All";
  });

  const toggleExpand = (id: string) => {
    const isCurrentlyExpanded = expanded[id] !== undefined 
      ? expanded[id] 
      : hasActiveFilters;
    setExpanded((prev) => ({
      ...prev,
      [id]: !isCurrentlyExpanded,
    }));
  };

  // Mouse drag handler for column resizing
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnIndex];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(60, startWidth + deltaX);
      setColumnWidths((prev) => ({
        ...prev,
        [columnIndex]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Inline table cell dropdown update handlers
  const handleEnquiryFieldChange = async (enquiryId: string, field: string, val: string) => {
    const toastId = toast.loading(`Saving ${field}...`);
    try {
      const dbVal = val === "" ? null : val;
      const res = await updateEnquiryFieldAction(enquiryId, field, dbVal);
      if (res.success) {
        toast.success("Saved successfully.", { id: toastId });
      } else {
        toast.error(res.error || "Failed to save.", { id: toastId });
      }
    } catch {
      toast.error("An error occurred while saving.", { id: toastId });
    }
  };

  const handleItemFieldChange = async (itemId: string, field: string, val: string) => {
    const toastId = toast.loading(`Saving ${field}...`);
    try {
      const dbVal = val === "" ? null : val;
      const res = await updateItemFieldAction(itemId, field, dbVal);
      if (res.success) {
        toast.success("Saved successfully.", { id: toastId });
      } else {
        toast.error(res.error || "Failed to save.", { id: toastId });
      }
    } catch {
      toast.error("An error occurred while saving.", { id: toastId });
    }
  };

  // Filter logic matching dropdown selections exactly
  const filteredEnquiries = enquiries.filter((enquiry) => {
    // 1. Enquiry Date range
    if (filters.enquiryDateFrom) {
      const fromDate = new Date(filters.enquiryDateFrom);
      if (new Date(enquiry.enquiryDate) < fromDate) return false;
    }
    if (filters.enquiryDateTo) {
      const toDate = new Date(filters.enquiryDateTo);
      const toDateLimit = new Date(toDate);
      toDateLimit.setDate(toDateLimit.getDate() + 1);
      if (new Date(enquiry.enquiryDate) > toDateLimit) return false;
    }

    // 2. Docket Number (Text Search)
    if (
      filters.docketNumber &&
      !enquiry.docketNumber
        .toLowerCase()
        .includes(filters.docketNumber.toLowerCase())
    ) {
      return false;
    }

    // 3. Party Name (Multi-select Checklist Search)
    if (
      filters.partyNames.length > 0 &&
      !filters.partyNames.includes(enquiry.partyName)
    ) {
      return false;
    }

    // 4-10. Enquiry-level Metadata Dropdown Filters
    if (
      filters.enquiryType !== "All" &&
      enquiry.enquiryType !== filters.enquiryType
    ) {
      return false;
    }
    if (
      filters.state !== "All" &&
      enquiry.state !== filters.state
    ) {
      return false;
    }
    if (
      filters.paymentTerms !== "All" &&
      enquiry.paymentTerms !== filters.paymentTerms
    ) {
      return false;
    }
    if (
      filters.inspection !== "All" &&
      enquiry.inspection !== filters.inspection
    ) {
      return false;
    }
    if (
      filters.pbg !== "All" &&
      enquiry.pbg !== filters.pbg
    ) {
      return false;
    }
    if (
      filters.utility &&
      !(enquiry.utility || "")
        .toLowerCase()
        .includes(filters.utility.toLowerCase())
    ) {
      return false;
    }
    if (
      filters.vaPercent &&
      !(enquiry.vaPercent !== null ? `${enquiry.vaPercent}%` : "")
        .toLowerCase()
        .includes(filters.vaPercent.toLowerCase())
    ) {
      return false;
    }
    if (
      filters.orderStatus !== "All" &&
      enquiry.orderStatus !== filters.orderStatus
    ) {
      return false;
    }

    // 11-24. Item details (mix of text search and exact dropdown selections)
    const matchesItems = enquiry.items.some((item) => {
      if (
        filters.itemName &&
        !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quantity &&
        !item.quantity.toString().includes(filters.quantity)
      ) {
        return false;
      }
      if (
        filters.itemType !== "All" &&
        item.itemType !== filters.itemType
      ) {
        return false;
      }
      if (
        filters.moc !== "All" &&
        item.moc !== filters.moc
      ) {
        return false;
      }
      if (
        filters.size !== "All" &&
        item.size !== filters.size
      ) {
        return false;
      }
      if (
        filters.pnRating !== "All" &&
        item.pnRating !== filters.pnRating
      ) {
        return false;
      }
      if (
        filters.operationType !== "All" &&
        item.operationType !== filters.operationType
      ) {
        return false;
      }
      if (
        filters.extension !== "All" &&
        item.extension !== filters.extension
      ) {
        return false;
      }
      if (
        filters.bypass !== "All" &&
        item.bypass !== filters.bypass
      ) {
        return false;
      }
      if (
        filters.productCost &&
        !(item.productCost?.toString() || "").includes(filters.productCost)
      ) {
        return false;
      }
      if (
        filters.costRefCode &&
        !(item.costRefCode || "").toLowerCase().includes(filters.costRefCode.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.cost &&
        !(item.cost?.toString() || "").includes(filters.cost)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !(item.stockStatus || "").toLowerCase().includes(filters.stockStatus.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.discount &&
        !(item.discount?.toString() || "").includes(filters.discount)
      ) {
        return false;
      }
      if (
        filters.quotedRate &&
        !(item.quotedRate || "").toLowerCase().includes(filters.quotedRate.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    if (!matchesItems) return false;

    // 25. Attachment
    if (filters.attachment) {
      if (!enquiry.attachments || enquiry.attachments.length === 0) return false;
      const match = enquiry.attachments.some((att) =>
        att.name.toLowerCase().includes(filters.attachment.toLowerCase())
      );
      if (!match) return false;
    }

    return true;
  });

  const paginatedEnquiries = filteredEnquiries.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleExportToExcel = () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows: any[] = [];

      filteredEnquiries.forEach((enquiry) => {
        if (!enquiry.items || enquiry.items.length === 0) {
          rows.push({
            "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
            "Docket No": enquiry.docketNumber,
            "Party Name": enquiry.partyName,
            "Enquiry Type": enquiry.enquiryType || "",
            "State": enquiry.state || "",
            "Payment Terms": enquiry.paymentTerms || "",
            "Inspection": enquiry.inspection || "",
            "PBG": enquiry.pbg || "",
            "Utility": enquiry.utility || "",
            "VA%": enquiry.vaPercent ? `${enquiry.vaPercent}%` : "",
            "Order Status": enquiry.orderStatus || "",
            "Item Name": "",
            "Quantity": "",
            "Item Type": "",
            "MOC": "",
            "Size": "",
            "PN Rating": "",
            "Operation Type": "",
            "Extension": "",
            "Bypass": "",
            "Product Cost": "",
            "Cost Ref Code": "",
            "Cost": "",
            "Stock Status": "",
            "Discount": "",
            "Quotation Rate": "",
            "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
            "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
          });
        } else {
          enquiry.items.forEach((item) => {
            rows.push({
              "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
              "Docket No": enquiry.docketNumber,
              "Party Name": enquiry.partyName,
              "Enquiry Type": enquiry.enquiryType || "",
              "State": enquiry.state || "",
              "Payment Terms": enquiry.paymentTerms || "",
              "Inspection": enquiry.inspection || "",
              "PBG": enquiry.pbg || "",
              "Utility": enquiry.utility || "",
              "VA%": enquiry.vaPercent ? `${enquiry.vaPercent}%` : "",
              "Order Status": enquiry.orderStatus || "",
              "Item Name": item.itemName,
              "Quantity": item.quantity ? Number(item.quantity) : "",
              "Item Type": item.itemType || "",
              "MOC": item.moc || "",
              "Size": item.size || "",
              "PN Rating": item.pnRating || "",
              "Operation Type": item.operationType || "",
              "Extension": item.extension || "",
              "Bypass": item.bypass || "",
              "Product Cost": item.productCost ? Number(item.productCost) : "",
              "Cost Ref Code": item.costRefCode || "",
              "Cost": item.cost ? Number(item.cost) : "",
              "Stock Status": item.stockStatus || "",
              "Discount": item.discount ? `${Number(item.discount)}%` : "",
              "Quotation Rate": item.quotedRate || "",
              "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
              "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
            });
          });
        }
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Enquiries");
      
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(workbook, `GMD_Quotation_Export_${dateStr}.xlsx`);
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: any) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const totalTableWidth = Object.values(columnWidths).reduce((a, b) => a + b, 0);

  const inputClass =
    "mt-1.5 w-full h-7 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-normal text-slate-700 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 normal-case";
  const selectClass =
    "mt-1.5 w-full h-7 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-normal text-slate-700 outline-none focus:border-blue-500 normal-case cursor-pointer";

  // Active inline cell dropdown styles (Google Sheets-like transparent border, visible chevron, hover background)
  const cellSelectClass =
    "w-full bg-transparent border-none text-xs text-slate-700 outline-none cursor-pointer focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-slate-100/80 transition-colors normal-case font-medium";
  const cellItemSelectClass =
    "w-full bg-transparent border-none text-xs text-slate-600 outline-none cursor-pointer focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-slate-100/80 transition-colors normal-case font-medium";

  return (
    <div className="flex flex-col flex-1 w-full max-w-full min-w-0">
      {/* Table Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-slate-50/75 border-b border-slate-200">
        <span className="text-[11px] font-semibold text-slate-500">
          Showing {filteredEnquiries.length} of {enquiries.length} enquiries
        </span>
        
        <Button
          type="button"
          onClick={handleExportToExcel}
          className="flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-[#0f62fe] border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer transition-all shadow-xs shrink-0"
        >
          <Download className="h-3.5 w-3.5 text-[#0f62fe] stroke-[2]" />
          Export Excel
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[70vh] w-full min-w-0 border-b border-slate-200">
        <table
        className="border-collapse text-left border border-slate-200"
        style={{ tableLayout: "fixed", width: totalTableWidth }}
      >
        <colgroup>
          {Object.keys(columnWidths).map((_, idx) => (
            <col key={idx} style={{ width: columnWidths[idx] }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-slate-50/75 select-none">
            {/* 0. Enquiry Date */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Enquiry Date</div>
              <div className="flex gap-1 items-center mt-1.5">
                <input
                  type="date"
                  value={filters.enquiryDateFrom}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, enquiryDateFrom: e.target.value }))
                  }
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-white text-slate-700 outline-none font-normal"
                />
                <span className="text-[9px] text-slate-400 font-normal">to</span>
                <input
                  type="date"
                  value={filters.enquiryDateTo}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, enquiryDateTo: e.target.value }))
                  }
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-white text-slate-700 outline-none font-normal"
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(0, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 1. Docket No */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Docket No</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.docketNumber}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, docketNumber: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(1, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 2. Party Name */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Party Name</div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-slate-700">
                <button
                  type="button"
                  onClick={() => setIsPartyFilterOpen(!isPartyFilterOpen)}
                  className="w-full h-7 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-left cursor-pointer flex items-center justify-between hover:bg-slate-50 outline-none"
                >
                  <span className="truncate">
                    {filters.partyNames.length === 0
                      ? "All Parties"
                      : `${filters.partyNames.length} Selected`}
                  </span>
                  <ChevronDown className="h-3 w-3 text-slate-400 shrink-0 ml-1" />
                </button>

                {isPartyFilterOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => {
                        setIsPartyFilterOpen(false);
                        setPartySearch("");
                      }}
                    />
                    <div className="absolute top-8 left-0 w-64 z-50 rounded border border-slate-200 bg-white shadow-lg p-2 flex flex-col gap-2 max-h-72">
                      <div className="flex items-center gap-1.5 border border-slate-100 rounded px-2 py-1 bg-slate-50">
                        <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <input
                          type="text"
                          placeholder="Search parties..."
                          value={partySearch}
                          onChange={(e) => setPartySearch(e.target.value)}
                          className="w-full text-[10px] bg-transparent outline-none border-none placeholder:text-slate-400 p-0 h-4 normal-case"
                        />
                      </div>

                      <div className="flex justify-between items-center px-1 text-[9px]">
                        <button
                          type="button"
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              partyNames: PARTY_NAMES,
                            }))
                          }
                          className="text-blue-600 font-bold hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              partyNames: [],
                            }))
                          }
                          className="text-slate-500 font-bold hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-48 pr-0.5">
                        {PARTY_NAMES.filter((name) =>
                          name.toLowerCase().includes(partySearch.toLowerCase())
                        ).map((name) => {
                          const isChecked = filters.partyNames.includes(name);
                          return (
                            <label
                              key={name}
                              className="flex items-center gap-2 py-1 px-1 hover:bg-slate-50 cursor-pointer select-none text-[10px] text-slate-700 font-medium truncate"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setFilters((prev) => {
                                    const exist = prev.partyNames.includes(name);
                                    const next = exist
                                      ? prev.partyNames.filter((n) => n !== name)
                                      : [...prev.partyNames, name];
                                    return { ...prev, partyNames: next };
                                  });
                                }}
                                className="h-3 w-3 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                              />
                              <span className="truncate">{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(2, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 3. Enquiry Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Enquiry Type</div>
              <select
                value={filters.enquiryType}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, enquiryType: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Types</option>
                {dropdownOptions.enquiryTypes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(3, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 4. State Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>State</div>
              <select
                value={filters.state}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, state: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All States</option>
                {dropdownOptions.states.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(4, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 5. Payment Terms Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Payment Terms</div>
              <select
                value={filters.paymentTerms}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, paymentTerms: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Terms</option>
                {dropdownOptions.paymentTerms.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(5, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 6. Inspection Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Inspection</div>
              <select
                value={filters.inspection}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, inspection: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All</option>
                {dropdownOptions.inspections.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(6, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 7. PBG Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>PBG</div>
              <select
                value={filters.pbg}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, pbg: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All</option>
                {dropdownOptions.pbgs.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(7, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 8. Utility Search */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Utility</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.utility}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, utility: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(8, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 9. VA% Search */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>VA%</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.vaPercent}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, vaPercent: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(9, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 10. Order Status Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Order Status</div>
              <select
                value={filters.orderStatus}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, orderStatus: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Statuses</option>
                {dropdownOptions.orderStatuses.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(10, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 11. Item Name As Per Party */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Item Name</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.itemName}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, itemName: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(11, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 12. Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Quantity</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.quantity}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, quantity: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(12, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 13. Item Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Item Type</div>
              <select
                value={filters.itemType}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, itemType: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Types</option>
                {dropdownOptions.itemTypes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(13, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 14. MOC Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>MOC</div>
              <select
                value={filters.moc}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, moc: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All MOCs</option>
                {dropdownOptions.mocs.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(14, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 15. Size Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Size</div>
              <select
                value={filters.size}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, size: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Sizes</option>
                {dropdownOptions.sizes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(15, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 16. PN Rating Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>PN Rating</div>
              <select
                value={filters.pnRating}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, pnRating: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Ratings</option>
                {dropdownOptions.pnRatings.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(16, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 17. Operation Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Operation Type</div>
              <select
                value={filters.operationType}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, operationType: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All Operations</option>
                {dropdownOptions.operationTypes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(17, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 18. Extension Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Extension</div>
              <select
                value={filters.extension}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, extension: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All</option>
                {dropdownOptions.extensions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(18, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 19. Bypass Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Bypass</div>
              <select
                value={filters.bypass}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, bypass: e.target.value }))
                }
                className={selectClass}
              >
                <option value="All">All</option>
                {dropdownOptions.bypasses.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <div
                onMouseDown={(e) => handleMouseDown(19, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 20. Product Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Product Cost</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.productCost}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, productCost: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(20, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 21. Cost Ref Code */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Cost Ref Code</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.costRefCode}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, costRefCode: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(21, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 22. Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Cost</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.cost}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, cost: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(22, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 23. Stock Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Stock Status</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.stockStatus}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, stockStatus: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(23, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 24. Discount */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Discount</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.discount}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, discount: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(24, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 25. Quoted Rate */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Quotation Rate</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.quotedRate}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, quotedRate: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(25, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 26. Attachment */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-r border-b border-slate-200 last:border-r-0">
              <div>Attachment</div>
              <input
                type="text"
                placeholder="Search..."
                value={filters.attachment}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, attachment: e.target.value }))
                }
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(26, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] transition-colors" />
              </div>
            </th>

            {/* 27. Actions */}
            <th className="sticky top-0 z-30 bg-slate-50 py-2.5 px-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase border-b border-slate-200 text-right">
              <div>Actions</div>
              <div className="h-7 mt-1.5" />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {filteredEnquiries.length === 0 ? (
            <tr>
              <td colSpan={28} className="py-20 px-4 text-center border-b border-slate-200">
                <div className="flex flex-col items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400 mb-4 border border-slate-100">
                    <Search className="h-6 w-6 stroke-[1.5]" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    No enquiries found
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 max-w-xs">
                    Get started by adding items or creating a new enquiry.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            paginatedEnquiries.map((enquiry) => {
              const { company, branch } = parseParty(enquiry.partyName);
              const initials = getInitials(enquiry.partyName);
              const hasMultiple = enquiry.items.length > 1;
              const isExpanded = expanded[enquiry.id] !== undefined
                ? expanded[enquiry.id]
                : hasActiveFilters;
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
                    {/* Enquiry Date */}
                    <td className="py-3.5 px-4 text-xs text-slate-500 border-r border-b border-slate-200 last:border-r-0 truncate">
                      {new Date(enquiry.enquiryDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>

                    {/* Docket No with expand arrow if applicable */}
                    <td className="py-3.5 px-4 text-xs font-semibold text-[#0f62fe] border-r border-b border-slate-200 last:border-r-0 truncate">
                      <div className="flex items-center">
                        {hasMultiple && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(enquiry.id)}
                            className="mr-1.5 inline-flex items-center justify-center p-0.5 hover:bg-slate-100 rounded text-slate-500 cursor-pointer focus:outline-none shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <span className="hover:underline cursor-pointer truncate">
                          {enquiry.docketNumber}
                        </span>
                        {hasMultiple && !isExpanded && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-medium bg-blue-50 text-blue-600 rounded-full border border-blue-100 shrink-0">
                            +{enquiry.items.length - 1} more items
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Party Name */}
                    <td className="py-3.5 px-4 border-r border-b border-slate-200 last:border-r-0 truncate">
                      <div className="flex items-center gap-3 truncate">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${badgeBg}`}
                        >
                          {initials}
                        </div>
                        <div className="flex flex-col truncate">
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {company}
                          </span>
                          {branch && (
                            <span className="text-[10px] text-slate-400 font-medium truncate">
                              {branch}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 3. Enquiry Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      <select
                        value={enquiry.enquiryType || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "enquiryType", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.enquiryTypes.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 4. State Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      <select
                        value={enquiry.state || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "state", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.states.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 5. Payment Terms Inline Select */}
                    <td className="py-1 px-1 border-r border-b border-slate-200 last:border-r-0 align-top group">
                      <div className="flex gap-0.5 items-start w-full">
                        <textarea
                          key={enquiry.paymentTerms || ""}
                          defaultValue={enquiry.paymentTerms || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (enquiry.paymentTerms || "")) {
                              handleEnquiryFieldChange(enquiry.id, "paymentTerms", e.target.value);
                            }
                          }}
                          placeholder="-"
                          rows={2}
                          className="w-full resize-none bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium cell-scrollable leading-normal max-h-12 overflow-y-auto"
                        />
                        <div className="relative shrink-0 w-4 h-7 flex items-center justify-center cursor-pointer">
                          <select
                            value={enquiry.paymentTerms || ""}
                            onChange={(e) => {
                              handleEnquiryFieldChange(enquiry.id, "paymentTerms", e.target.value);
                              const flexContainer = e.target.closest('.flex');
                              const textarea = flexContainer ? flexContainer.querySelector('textarea') : null;
                              if (textarea) textarea.value = e.target.value;
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                          >
                            <option value="">-</option>
                            {dropdownOptions.paymentTerms.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <ChevronDown className="h-3 w-3 text-slate-400 pointer-events-none group-hover:text-slate-600 z-0" />
                        </div>
                      </div>
                    </td>

                    {/* 6. Inspection Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      <select
                        value={enquiry.inspection || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "inspection", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.inspections.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 7. PBG Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      <select
                        value={enquiry.pbg || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "pbg", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.pbgs.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 8. Utility Inline Input */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      <input
                        type="text"
                        defaultValue={enquiry.utility || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.utility || "")) {
                            handleEnquiryFieldChange(enquiry.id, "utility", e.target.value);
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                      />
                    </td>

                    {/* 9. VA% Inline Input */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      <input
                        type="text"
                        defaultValue={enquiry.vaPercent !== null ? `${enquiry.vaPercent}%` : ""}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (enquiry.vaPercent !== null ? `${enquiry.vaPercent}%` : "")) {
                            handleEnquiryFieldChange(enquiry.id, "vaPercent", val);
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                      />
                    </td>

                    {/* 10. Order Status Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      <select
                        value={enquiry.orderStatus || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "orderStatus", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.orderStatuses.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* First Item Name */}
                    <td className="py-2 px-2 text-xs text-slate-600 font-medium border-r border-b border-slate-200 last:border-r-0 align-top">
                      <div className="max-h-12 overflow-y-auto w-full pr-1 cell-scrollable break-words whitespace-normal leading-normal">
                        {firstItem ? firstItem.itemName : "No items"}
                      </div>
                    </td>

                    {/* First Item Quantity */}
                    <td className="py-3.5 px-4 text-xs text-slate-600 font-semibold border-r border-b border-slate-200 last:border-r-0 truncate">
                      {firstItem ? formatQuantity(firstItem.itemName, firstItem.quantity) : "-"}
                    </td>

                    {/* 13. First Item Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.itemType || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "itemType", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.itemTypes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 14. First Item MOC Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.moc || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "moc", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.mocs.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 15. First Item Size Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.size || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "size", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.sizes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 16. First Item PN Rating Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.pnRating || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "pnRating", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.pnRatings.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 17. First Item Operation Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.operationType || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "operationType", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.operationTypes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 18. First Item Extension Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.extension || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "extension", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.extensions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 19. First Item Bypass Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.bypass || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "bypass", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.bypasses.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* First Item Product Cost */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.productCost ? Number(firstItem.productCost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.productCost ? Number(firstItem.productCost).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "productCost", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost Ref Code */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.costRefCode || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.costRefCode || "")) {
                              handleItemFieldChange(firstItem.id, "costRefCode", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.cost ? Number(firstItem.cost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.cost ? Number(firstItem.cost).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "cost", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Stock Status */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.stockStatus || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.stockStatus || "")) {
                              handleItemFieldChange(firstItem.id, "stockStatus", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Discount */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.discount ? Number(firstItem.discount).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.discount ? Number(firstItem.discount).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "discount", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Quoted Rate */}
                    <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.quotedRate || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.quotedRate || "")) {
                              handleItemFieldChange(firstItem.id, "quotedRate", e.target.value);
                            }
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* Attachment */}
                    <td className="py-3.5 px-4 text-xs border-r border-b border-slate-200 last:border-r-0 truncate">
                      {enquiry.attachments && enquiry.attachments.length > 0 ? (
                        <div className="flex flex-col gap-1 max-w-[150px]">
                          {enquiry.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.url || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs font-semibold text-[#0f62fe] hover:underline truncate"
                            >
                              <FileText className="h-3.5 w-3.5 text-[#0f62fe] stroke-[2] shrink-0" />
                              <span className="truncate">{att.name}</span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right border-b border-slate-200">
                      {firstItem && (
                        <ActionsDropdown
                          item={{
                            ...firstItem,
                            enquiry: {
                              id: enquiry.id,
                              docketNumber: enquiry.docketNumber,
                              partyName: enquiry.partyName,
                              enquiryDate: enquiry.enquiryDate,
                              attachments: enquiry.attachments,
                              enquiryType: enquiry.enquiryType,
                              state: enquiry.state,
                              paymentTerms: enquiry.paymentTerms,
                              inspection: enquiry.inspection,
                              pbg: enquiry.pbg,
                              utility: enquiry.utility,
                              vaPercent: enquiry.vaPercent,
                              orderStatus: enquiry.orderStatus,
                            },
                          }}
                          dropdownOptions={dropdownOptions}
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
                        {/* Empty cells for docket information to align items */}
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>

                        {/* Additional Item Name */}
                        <td className="py-2 px-2 text-xs text-slate-600 font-medium border-r border-b border-slate-200 last:border-r-0 align-top">
                          <div className="max-h-12 overflow-y-auto w-full pr-1 cell-scrollable break-words whitespace-normal leading-normal">
                            {item.itemName}
                          </div>
                        </td>
                        
                        {/* Additional Item Quantity */}
                        <td className="py-3.5 px-4 text-xs text-slate-600 font-semibold border-r border-b border-slate-200 last:border-r-0 truncate">
                          {formatQuantity(item.itemName, item.quantity)}
                        </td>

                        {/* 13. Item Type Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.itemType || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "itemType", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.itemTypes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 14. MOC Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.moc || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "moc", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.mocs.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 15. Size Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.size || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "size", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.sizes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 16. PN Rating Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.pnRating || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "pnRating", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.pnRatings.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 17. Operation Type Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.operationType || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "operationType", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.operationTypes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 18. Extension Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.extension || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "extension", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.extensions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 19. Bypass Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-slate-200 last:border-r-0">
                          <select
                            value={item.bypass || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "bypass", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.bypasses.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* Product Cost */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.productCost ? Number(item.productCost).toString() : ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.productCost ? Number(item.productCost).toString() : "")) {
                                handleItemFieldChange(item.id, "productCost", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                          />
                        </td>

                        {/* Cost Ref Code */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.costRefCode || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.costRefCode || "")) {
                                handleItemFieldChange(item.id, "costRefCode", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                          />
                        </td>

                        {/* Cost */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.cost ? Number(item.cost).toString() : ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.cost ? Number(item.cost).toString() : "")) {
                                handleItemFieldChange(item.id, "cost", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                          />
                        </td>

                        {/* Stock Status */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.stockStatus || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.stockStatus || "")) {
                                handleItemFieldChange(item.id, "stockStatus", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                          />
                        </td>

                        {/* Discount */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.discount ? Number(item.discount).toString() : ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.discount ? Number(item.discount).toString() : "")) {
                                handleItemFieldChange(item.id, "discount", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium text-right"
                          />
                        </td>

                        {/* Quoted Rate */}
                        <td className="py-2 px-2 border-r border-b border-slate-200 last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.quotedRate || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.quotedRate || "")) {
                                handleItemFieldChange(item.id, "quotedRate", e.target.value);
                              }
                            }}
                            placeholder="-"
                            className="w-full bg-transparent border-none text-xs text-slate-700 outline-none p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded hover:bg-slate-100/80 transition-colors font-medium"
                          />
                        </td>

                        {/* Empty attachment column */}
                        <td className="py-3 px-4 border-r border-b border-slate-200 last:border-r-0"></td>

                        {/* Actions on this item */}
                        <td className="py-3.5 px-4 text-right border-b border-slate-200">
                          <ActionsDropdown
                            item={{
                              ...item,
                              enquiry: {
                                id: enquiry.id,
                                docketNumber: enquiry.docketNumber,
                                partyName: enquiry.partyName,
                                enquiryDate: enquiry.enquiryDate,
                                attachments: enquiry.attachments,
                                enquiryType: enquiry.enquiryType,
                                state: enquiry.state,
                                paymentTerms: enquiry.paymentTerms,
                                inspection: enquiry.inspection,
                                pbg: enquiry.pbg,
                                utility: enquiry.utility,
                                vaPercent: enquiry.vaPercent,
                                orderStatus: enquiry.orderStatus,
                              },
                            }}
                            dropdownOptions={dropdownOptions}
                          />
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {filteredEnquiries.length > 0 && (
      <Pagination
        currentPage={currentPage}
        totalCount={filteredEnquiries.length}
        pageSize={pageSize}
        onPageChange={(page) => setCurrentPage(page)}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
      />
    )}
  </div>
  );
}
