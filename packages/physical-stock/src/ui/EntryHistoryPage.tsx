"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Loader2, RotateCcw, RotateCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { cn } from "@gmd/ui/lib/utils";
import { searchCode, selectEntry, selectEntryHistory } from "../state/historySlice";
import type { EntryHistoryActions, StockEntryRow } from "../types";

export interface EntryHistoryPageProps {
  actions: EntryHistoryActions;
  /** Admin / developer: shows the Revert action on counted entries. */
  canRevert: boolean;
}

const NONE: string[] = [];
const noop = () => undefined;
const nullFacet = () => null;

/** Every entry booked against one ERP code, newest first; empty until a code is searched. */
export function EntryHistoryPage({ actions, canRevert }: EntryHistoryPageProps) {
  const dispatch = useDispatch();
  const { code, selectedId } = useSelector(selectEntryHistory);
  const [draft, setDraft] = useState(code);
  const [rows, setRows] = useState<StockEntryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!code) return setRows(null);
    setLoading(true);
    const res = await actions.loadEntries(code);
    setLoading(false);
    if (res.success) setRows(res.data);
    else toast.error(res.error || "Could not load entries.");
  }, [actions, code]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    dispatch(searchCode(draft));
  };

  // First click arms the button, second click acts: revert takes the qty out, restore counts it again.
  const toggle = useCallback(
    async (entry: StockEntryRow) => {
      if (confirmId !== entry.id) return setConfirmId(entry.id);
      setConfirmId(null);
      const restoring = !entry.merged;
      const verb = restoring ? "Restor" : "Revert";
      const type = entry.qty_type === "dispatch" ? "dispatched" : "received";
      const id = toast.loading(`${verb}ing ${entry.entry_no}…`);
      const res = await (restoring ? actions.restoreEntry : actions.revertEntry)!(entry.entry_no);
      if (res.success) {
        toast.success(`${entry.entry_no} ${restoring ? "restored" : "reverted"}: ${entry.qty ?? 0} ${restoring ? "added back to" : "taken out of"} ${type}`, { id });
        void load();
      } else toast.error(res.error || `Could not ${verb.toLowerCase()} ${entry.entry_no}`, { id });
    },
    [actions, confirmId, load],
  );

  const columns = useMemo<DataColumn<StockEntryRow>[]>(() => {
    const cols: DataColumn<StockEntryRow>[] = [
      { key: "entry_no", label: "Entry no", kind: "text", sticky: true, width: 150 },
      { key: "created_at", label: "Booked", kind: "date", width: 120 },
      { key: "qty_type", label: "Type", kind: "text", width: 110, render: (r) => (r.qty_type === "dispatch" ? "Dispatched" : "Received") },
      { key: "qty", label: "Quantity", kind: "number", align: "right", width: 110 },
      {
        key: "merged",
        label: "Status",
        kind: "text",
        width: 110,
        render: (r) => (
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", r.merged ? "text-primary" : "text-muted-foreground line-through")}>
            <span className={cn("size-1.5 rounded-full", r.merged ? "bg-primary" : "bg-muted-foreground")} />
            {r.merged ? "Counted" : "Reverted"}
          </span>
        ),
      },
      { key: "created_by", label: "By", kind: "text", width: 200 },
      { key: "location", label: "Location", kind: "text", width: 110 },
      { key: "description", label: "Item", kind: "text", width: 360 },
    ];
    if (canRevert) {
      cols.push({
        key: "id",
        label: "",
        kind: "text",
        width: 150,
        render: (r) => {
          const armed = confirmId === r.id;
          const can = r.merged ? actions.revertEntry : actions.restoreEntry;
          if (!can) return null;
          return (
            <Button
              variant={armed ? (r.merged ? "destructive" : "default") : "ghost"}
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                void toggle(r);
              }}
              onBlur={() => armed && setConfirmId(null)}
            >
              {r.merged ? <RotateCcw /> : <RotateCw />}
              {r.merged ? (armed ? "Confirm revert" : "Revert") : armed ? "Confirm restore" : "Restore"}
            </Button>
          );
        },
      });
    }
    return cols;
  }, [canRevert, confirmId, toggle, actions]);

  const counted = rows?.filter((r) => r.merged).length ?? 0;

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-6">
        <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2">
          <label htmlFor="history-code" className="text-sm font-medium">
            Entry history by ERP code
          </label>
          <div className="relative flex w-full items-center">
            <Search size={18} className="pointer-events-none absolute left-4 text-muted-foreground" aria-hidden />
            <input
              id="history-code"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="Type an ERP code and press Enter"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="h-12 w-full rounded-xl border border-input bg-background pr-28 pl-11 font-mono text-base tracking-wide uppercase outline-none transition-[box-shadow,border-color] duration-150 placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none dark:bg-input/30"
            />
            <Button type="submit" size="sm" disabled={!draft.trim() || loading} className="absolute right-2">
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Search
            </Button>
          </div>
          {code && rows && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {rows.length === 0
                ? `No entries for ${code}.`
                : `${rows.length} ${rows.length === 1 ? "entry" : "entries"} for ${code}, ${counted} counted.`}
            </p>
          )}
        </form>

        {code ? (
          <DataTable
            columns={columns}
            rows={rows ?? []}
            rowId={(r) => r.id}
            sort={null}
            onSortChange={noop}
            filters={{}}
            onFilterChange={noop}
            facetOptions={nullFacet}
            onFacetOpen={noop}
            selectedId={selectedId}
            onSelect={(id) => dispatch(selectEntry(id))}
            loading={loading && rows === null}
            refreshing={loading && rows !== null}
            hasFilters={false}
            onClearFilters={noop}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium">Search an ERP code to see its entries</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Every New Item submit is an entry. The list shows what was booked, by whom, and whether it still counts in stock.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
