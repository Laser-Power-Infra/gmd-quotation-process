"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable, {
  type ServerTableMode,
} from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  addBisStatusUpdateAction,
  createBisStatusAction,
  getBisStaleIdsAction,
  getBisStatusHistoryAction,
  updateBisStatusFieldAction,
  uploadBisDocsAction,
} from "@/app/actions/misc";
import DocketAttachmentsCell from "@/components/attachment/DocketAttachmentsCell";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@gmd/ui/components/dialog";
import {
  fetchAllBisRows,
  fetchBisFacet,
  fetchBisPage,
} from "@/app/actions/bisQuery";
import { BIS_HEADER_TO_DB_FIELD, BIS_STATUS_HEADERS } from "@/lib/gmd_lib/bis-status-columns";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  setColumnFilter,
  setMultiFilter,
  setDateFrom,
  setDateTo,
  setGlobalSearch,
  setPage,
  setPageSize,
  resetFilters,
} from "@/lib/bisStatusFiltersSlice";
import { useServerTable } from "@/lib/useServerTable";
import type { BisQuery } from "@/lib/bisQuery";
import type { TableSort } from "@/lib/tableQuery";

const EDITABLE_FIELDS = new Set(["remark", "licenseNo", "bisDocs"]);
const EMPTY_FORM = { status: "", nextStep: "", nextDate: "", remark: "", updatedBy: "" };
const EMPTY_NEW_ROW = { itemName: "", bisNo: "", licenseNo: "", applicationStatus: "", expiryDate: "" };
const DOCS_HEADER = "BIS Documents (Link)";
const DOCS_IDX = BIS_STATUS_HEADERS.indexOf(DOCS_HEADER);
const BIS_NO_IDX = BIS_STATUS_HEADERS.indexOf("bisNo");
// Same per-file limit as uploadBisDocsAction, checked here so an oversized file is never sent.
const MAX_DOC_MB = 25;
type HistoryRow = {
  id: string;
  createdAt: string | Date;
  status: string | null;
  nextStep: string | null;
  nextDate: string | Date | null;
  remark: string | null;
  updatedBy: string | null;
};
const fmtDate = (v: string | Date | null) => (v ? new Date(v).toLocaleDateString() : "");

/** Docs cell: paste links as before, upload licence copies (appended), preview every link. */
function BisDocsCell({
  value,
  bisNo,
  onSave,
  onUpload,
}: {
  value: string;
  bisNo: string;
  onSave: (value: string) => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Unique: each link is its own attachment id, so the preview keeps its place when the list changes.
  const links = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <input
        key={value}
        defaultValue={value}
        placeholder="Paste links or upload"
        aria-label="BIS document links"
        onBlur={(e) => {
          if (e.target.value !== value) onSave(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="flex-1 min-w-0 text-xs bg-transparent border-none outline-none"
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        // Same PDF/image rule as uploadBisDocsAction.
        accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length === 0) return;
          setUploading(true);
          void onUpload(files).finally(() => setUploading(false));
        }}
      />
      <DocketAttachmentsCell
        compact
        docketNumber={bisNo}
        attachments={links.map((url, i) => ({ id: url, name: `File ${i + 1}`, url, type: null, size: null }))}
        onAddClick={() => fileRef.current?.click()}
        addDisabled={uploading}
      />
    </div>
  );
}

export default function BisStatusPage() {
  const dispatch = useAppDispatch();
  const filterState = useAppSelector((s) => s.bisStatusFilters);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [staleIds, setStaleIds] = useState<ReadonlySet<string>>(new Set());
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [newRow, setNewRow] = useState<typeof EMPTY_NEW_ROW | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  const headers = useMemo<string[]>(() => [...BIS_STATUS_HEADERS], []);

  const query: BisQuery = useMemo(
    () => ({ filters: filterState, sort }),
    [filterState, sort],
  );

  const queryKey = useMemo(
    () => JSON.stringify({ filters: filterState, sort }),
    [filterState, sort],
  );

  // Paging/sorting must not invalidate the dropdown options.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        columnFilters: filterState.columnFilters,
        multiFilters: filterState.multiFilters,
        dateFrom: filterState.dateFrom,
        dateTo: filterState.dateTo,
        globalSearch: filterState.globalSearch,
      }),
    [filterState],
  );

  const {
    rows,
    ids,
    total,
    syncedAt,
    loading,
    refreshing,
    error,
    getFacetOptions,
    requestFacet,
    refresh,
    patchCell,
  } = useServerTable({
    queryKey,
    filterKey,
    fetchPage: () => fetchBisPage(query),
    fetchFacet: (header) => fetchBisFacet(query, header),
  });

  const loadStale = useCallback(async () => {
    const res = await getBisStaleIdsAction();
    if (res?.success) setStaleIds(new Set<string>(res.data));
  }, []);
  useEffect(() => {
    void loadStale();
  }, [loadStale]);

  const selectedId = selectedIndex !== null ? ids[selectedIndex] : undefined;

  const openAdd = () => {
    if (!selectedId || selectedIndex === null) return toast.error("Select a row first");
    const status = rows[selectedIndex]?.[headers.indexOf("applicationStatus")];
    setForm({ ...EMPTY_FORM, status: status ? String(status) : "" });
  };

  const submitAdd = async () => {
    if (!form || !selectedId) return;
    setSaving(true);
    try {
      const res = await addBisStatusUpdateAction({ bisStatusId: selectedId, ...form });
      if (res?.success === false) {
        toast.error(res.error || "Failed to add update");
        return;
      }
      toast.success("Update added");
      setForm(null);
      void refresh();
      void loadStale();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add update");
    } finally {
      setSaving(false);
    }
  };

  const submitNewRow = async () => {
    if (!newRow) return;
    setSaving(true);
    try {
      const res = await createBisStatusAction(newRow);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("BIS row added");
      setNewRow(null);
      void refresh();
      void loadStale();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add BIS row");
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async () => {
    if (!selectedId) return toast.error("Select a row first");
    const res = await getBisStatusHistoryAction(selectedId);
    if (res?.success === false) return toast.error(res.error || "Failed to load history");
    setHistory(res.data);
  };

  const changePage = useCallback(
    (page: number) => dispatch(setPage(page)),
    [dispatch],
  );
  const changePageSize = useCallback(
    (size: number) => {
      dispatch(setPageSize(size));
      dispatch(setPage(1));
    },
    [dispatch],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        dispatch(setColumnFilter({ header, value })),
      onMultiFilter: (header: string, values: string[]) =>
        dispatch(setMultiFilter({ header, values })),
      onDateFrom: (val: string) => dispatch(setDateFrom(val)),
      onDateTo: (val: string) => dispatch(setDateTo(val)),
      onGlobalSearch: (val: string) => dispatch(setGlobalSearch(val)),
      onResetFilters: () => {
        dispatch(resetFilters());
        setSort(null);
      },
      onPageChange: changePage,
      onPageSizeChange: changePageSize,
    }),
    [dispatch, changePage, changePageSize],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = BIS_HEADER_TO_DB_FIELD[header];
      if (!field) return;
      if (!EDITABLE_FIELDS.has(field)) {
        toast.error(`Field ${header} is not editable`);
        return;
      }
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        const res = await updateBisStatusFieldAction(id, field, value || null);
        if (res?.success === false) {
          toast.error(res.error || `Failed to update ${header}`, { id: toastId });
          return;
        }
        patchCell(id, colIndex, value || null);
        toast.success(`${header} updated`, { id: toastId });
        // Filters, sort position and the header count may all have changed.
        void refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : `Failed to update ${header}`,
          { id: toastId },
        );
      }
    },
    [headers, patchCell, refresh],
  );

  const uploadDocs = useCallback(
    async (id: string, files: File[]) => {
      let uploaded = 0;
      // One file per call: a failure costs only that file, and no request nears the server's body limit.
      for (const file of files) {
        if (file.size > MAX_DOC_MB * 1024 * 1024) {
          toast.error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Files must be ${MAX_DOC_MB} MB or smaller.`);
          continue;
        }
        const toastId = toast.loading(`Uploading "${file.name}"...`);
        try {
          const res = await uploadBisDocsAction(id, [file]);
          if (!res.success) {
            toast.error(res.error, { id: toastId });
            continue;
          }
          patchCell(id, DOCS_IDX, res.data.bisDocs);
          toast.success(`Uploaded "${file.name}"`, { id: toastId });
          uploaded++;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Upload of "${file.name}" failed`, { id: toastId });
        }
      }
      if (uploaded > 0) void refresh();
    },
    [patchCell, refresh],
  );

  const customCells = useMemo(
    () => ({
      [DOCS_HEADER]: (row: unknown[], id: string) => (
        <BisDocsCell
          value={String(row[DOCS_IDX] ?? "")}
          bisNo={String(row[BIS_NO_IDX] ?? "")}
          onSave={(value) => void handleCellUpdate(id, DOCS_IDX, value)}
          onUpload={(files) => uploadDocs(id, files)}
        />
      ),
    }),
    [handleCellUpdate, uploadDocs],
  );

  const serverSort = useMemo(
    () =>
      sort
        ? { column: headers.indexOf(sort.header), direction: sort.direction }
        : null,
    [sort, headers],
  );

  const serverMode: ServerTableMode = useMemo(
    () => ({
      total,
      page: filterState.currentPage,
      pageSize: filterState.pageSize,
      loading,
      refreshing,
      sort: serverSort,
      onSortChange: (next) => {
        if (!next) {
          setSort(null);
          return;
        }
        const header = headers[next.column];
        setSort(header ? { header, direction: next.direction } : null);
        dispatch(setPage(1));
      },
      onPageChange: changePage,
      onPageSizeChange: changePageSize,
      getFacetOptions,
      requestFacet,
      getAllRows: () => fetchAllBisRows(query),
    }),
    [
      total,
      filterState.currentPage,
      filterState.pageSize,
      loading,
      refreshing,
      serverSort,
      headers,
      dispatch,
      changePage,
      changePageSize,
      getFacetOptions,
      requestFacet,
      query,
    ],
  );

  if (loading && rows.length === 0) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="BIS STATUS" totalRows={0} />
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
            <GMDUpdateSkeleton />
          </div>
        </div>
      </main>
    );
  }

  if (error && rows.length === 0) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="BIS STATUS" totalRows={0} />
          <ErrorState message={error} onRetry={refresh} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader
          title="BIS STATUS"
          totalRows={total}
          syncedAt={syncedAt}
        />
        {error && rows.length > 0 && (
          <div className="mt-2 text-sm text-red-600 dark:text-red-300 shrink-0">
            {error}
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
          <GMDUpdateTable
            headers={headers}
            rows={rows}
            ids={ids}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="BIS Status"
            editable
            editableColumns={["remark", "licenseNo", DOCS_HEADER]}
            onCellUpdate={handleCellUpdate}
            customCells={customCells}
            uniqueKeyColumns={["bisNo"]}
            // The docs cell is an input for pasting links; this adds a clickable links button next to the item name.
            linkedFilesColumn={DOCS_HEADER}
            linkedFilesIconColumn="itemName"
            filterState={filterState}
            filterActions={filterActions}
            serverMode={serverMode}
            warningRowIds={staleIds}
            warningColumn="itemName"
            warningTitle="No update in 3+ days"
            toolbarExtra={
              <>
                <Button size="sm" variant="outline" onClick={() => setNewRow(EMPTY_NEW_ROW)}>New BIS row</Button>
                <Button size="sm" variant="outline" onClick={openAdd}>Add update</Button>
                <Button size="sm" variant="outline" onClick={openHistory}>History</Button>
              </>
            }
            fullHeight
          />
        </div>
        <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add update</DialogTitle></DialogHeader>
            {form && (
              <div className="grid gap-2">
                {([
                  ["status", "Status", "text"],
                  ["nextStep", "Next step", "text"],
                  ["nextDate", "Next follow-up date", "date"],
                  ["remark", "Remark", "text"],
                  ["updatedBy", "Updated by", "text"],
                ] as const).map(([key, label, type]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    {label}
                    <Input
                      type={type}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={submitAdd} disabled={saving}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!newRow} onOpenChange={(o) => !o && setNewRow(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>New BIS row</DialogTitle></DialogHeader>
            {newRow && (
              <div className="grid gap-2">
                {([
                  ["itemName", "Product", "text"],
                  ["bisNo", "BIS No (required)", "text"],
                  ["licenseNo", "Licence / application no", "text"],
                  ["applicationStatus", "Status", "text"],
                  ["expiryDate", "Expiry date", "date"],
                ] as const).map(([key, label, type]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    {label}
                    <Input
                      type={type}
                      value={newRow[key]}
                      onChange={(e) => setNewRow({ ...newRow, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewRow(null)}>Cancel</Button>
              <Button onClick={submitNewRow} disabled={saving}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>History</DialogTitle></DialogHeader>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    {["Date", "Status", "Next step", "Next date", "Remark", "By"].map((h) => (
                      <th key={h} className="p-1">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history?.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="p-1">{fmtDate(u.createdAt)}</td>
                      <td className="p-1">{u.status}</td>
                      <td className="p-1">{u.nextStep}</td>
                      <td className="p-1">{fmtDate(u.nextDate)}</td>
                      <td className="p-1">{u.remark}</td>
                      <td className="p-1">{u.updatedBy}</td>
                    </tr>
                  ))}
                  {history?.length === 0 && (
                    <tr><td colSpan={6} className="p-2 text-muted-foreground">No updates yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
