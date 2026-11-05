"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../button";
import { Segmented } from "../segmented";
import { PAGE_SIZES } from "./types";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const n = new Intl.NumberFormat("en-IN");

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav className="flex items-center justify-between gap-3 text-xs text-muted-foreground" aria-label="Pagination">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <Segmented label="Rows per page" options={PAGE_SIZES.map((size) => ({ value: size, label: String(size) }))} value={pageSize} onChange={onPageSizeChange} />
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-2 tabular-nums" aria-live="polite">
          {total === 0 ? "No rows" : `${n.format(from)}–${n.format(to)} of ${n.format(total)}`}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-12 text-center tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
