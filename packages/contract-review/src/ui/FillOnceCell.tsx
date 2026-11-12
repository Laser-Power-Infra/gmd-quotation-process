"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

/** A value that can be typed in once: filled shows as text, blank gets an input and a tick to save. */
export function FillOnceCell({
  value,
  label,
  onSave,
}: {
  value: unknown;
  label: string;
  /** Omit to show the cell read-only. */
  onSave?: (value: string) => Promise<void>;
}) {
  const shown = String(value ?? "").trim();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  if (shown || !onSave) {
    return <span className="block truncate" title={shown}>{shown || "—"}</span>;
  }

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(draft.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void save();
        }}
        placeholder={label}
        aria-label={label}
        disabled={busy}
        className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !draft.trim()}
        title={`Save ${label} (cannot be changed afterwards)`}
        aria-label={`Save ${label}`}
        className="shrink-0 rounded border border-emerald-500/50 p-0.5 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-300"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
    </div>
  );
}
