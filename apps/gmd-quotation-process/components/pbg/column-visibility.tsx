"use client";

import {
  DEFAULT_VISIBLE_COLUMNS,
  PBG_COLUMN_DEFS,
  type ColumnKey,
} from "@/lib/pbg/pbg-columns";

type ColumnVisibilityProps<K extends string> = {
  visible: K[];
  onChange: (keys: K[]) => void;
  /** Defaults to the PBG table columns; other tables pass their own. `locked` columns cannot be hidden. */
  defs?: readonly { key: K; label: string; locked?: boolean }[];
  defaults?: K[];
};

export function ColumnVisibility<K extends string = ColumnKey>({
  visible,
  onChange,
  defs = PBG_COLUMN_DEFS as unknown as readonly { key: K; label: string }[],
  defaults = DEFAULT_VISIBLE_COLUMNS as unknown as K[],
}: ColumnVisibilityProps<K>) {
  const visibleSet = new Set<K>(visible);

  function toggle(key: K) {
    const next = new Set(visibleSet);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(defs.map((d) => d.key).filter((k) => next.has(k)));
  }

  return (
    <div className="w-60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">Columns</span>
        <button
          type="button"
          onClick={() => onChange(defaults)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          Reset
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {defs.map((column) => (
          <label
            key={column.key}
            className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={visibleSet.has(column.key)}
              disabled={"locked" in column && !!column.locked}
              onChange={() => toggle(column.key)}
              className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            {column.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        At least one column stays visible.
      </p>
    </div>
  );
}
