"use client";

import { useMemo, useState } from "react";
import { User } from "lucide-react";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import Pagination from "@/components/table/Pagination";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { filterDebtors } from "@/lib/debtors";
import type { DebtorRow, DebtorTotals } from "@/lib/debtors";

interface DebtorsTableProps {
  rows: DebtorRow[];
  totals: DebtorTotals;
}

const COLUMNS = [
  { key: "accSch", label: "Acc Sch", numeric: false },
  { key: "accCode", label: "Acc Code", numeric: false },
  { key: "accName", label: "Acc Name", numeric: false },
  { key: "tCode", label: "T Code", numeric: false },
  { key: "vrNo", label: "Vr No", numeric: false },
  { key: "vrDate", label: "Vr Date", numeric: false },
  { key: "dueDate", label: "Due Date", numeric: false },
  { key: "particular", label: "Particular", numeric: false },
  { key: "drAmt", label: "Dr Amt", numeric: true },
  { key: "drAllocAmt", label: "Dr Alloc Amt", numeric: true },
  { key: "unAllocDr", label: "Un Alloc Dr", numeric: true },
  { key: "unAllocCr", label: "Un Alloc Cr", numeric: true },
  { key: "partyBillNo", label: "Party Bill No", numeric: false },
  { key: "partyBillDate", label: "Party Bill Date", numeric: false },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(value: number | null): string {
  return value === null ? "-" : formatIndianNumber(value, 2);
}

function cellValue(row: DebtorRow, key: (typeof COLUMNS)[number]["key"]) {
  switch (key) {
    case "vrDate":
      return formatDate(row.vrDate);
    case "dueDate":
      return formatDate(row.dueDate);
    case "partyBillDate":
      return formatDate(row.partyBillDate);
    case "drAmt":
      return formatAmount(row.drAmt);
    case "drAllocAmt":
      return formatAmount(row.drAllocAmt);
    case "unAllocDr":
      return formatAmount(row.unAllocDr);
    case "unAllocCr":
      return formatAmount(row.unAllocCr);
    default:
      return row[key] ?? "-";
  }
}

export default function DebtorsTable({ rows, totals }: DebtorsTableProps) {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filteredRows = useMemo(
    () => filterDebtors(rows, search),
    [rows, search],
  );

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">DEBTORS</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {filteredRows.length} rows
        </span>
        <div className="ml-auto w-72">
          <DebouncedSearchInput
            value={search}
            onCommit={(value) => {
              setSearch(value);
              setCurrentPage(1);
            }}
            placeholder="Search code, name, voucher, bill no, particular"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 select-none">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap border-r border-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${
                    column.numeric ? "text-right" : ""
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="py-16 text-center">
                  <User className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium text-muted-foreground">
                    No debtors data synced yet.
                  </p>
                </td>
              </tr>
            ) : paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="py-16 text-center text-sm font-medium text-muted-foreground"
                >
                  No rows match your search.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/40">
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap border-r border-border px-3 py-2 ${
                        column.numeric
                          ? "text-right tabular-nums"
                          : "text-foreground"
                      }`}
                    >
                      {cellValue(row, column.key)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 border-t border-border bg-muted/60 font-semibold">
              <tr>
                <td colSpan={8} className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Totals (all rows)
                </td>
                <td className="border-r border-border px-3 py-2 text-right tabular-nums">
                  {formatAmount(totals.drAmt)}
                </td>
                <td className="border-r border-border px-3 py-2 text-right tabular-nums">
                  {formatAmount(totals.drAllocAmt)}
                </td>
                <td className="border-r border-border px-3 py-2 text-right tabular-nums">
                  {formatAmount(totals.unAllocDr)}
                </td>
                <td className="border-r border-border px-3 py-2 text-right tabular-nums">
                  {formatAmount(totals.unAllocCr)}
                </td>
                <td className="border-r border-border px-3 py-2" />
                <td className="border-r border-border px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {rows.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredRows.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
