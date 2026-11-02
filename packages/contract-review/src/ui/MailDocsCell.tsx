"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { MAIL_DOC_CATEGORIES, parseMailDocs } from "../lib/columns";

/** Clickable "Category: link" list for one contract, with an optional add form. */
export function MailDocsCell({
  value,
  onAdd,
}: {
  value: unknown;
  onAdd?: (category: string, url: string) => Promise<boolean>;
}) {
  const docs = parseMailDocs(value);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(MAIL_DOC_CATEGORIES[0]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const ok = await onAdd?.(category, url);
    setBusy(false);
    if (ok) {
      setUrl("");
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
      {docs.map((d, i) => (
        <a
          key={`${d.u}-${i}`}
          href={d.u}
          target="_blank"
          rel="noopener noreferrer"
          title={d.u}
          className="truncate underline text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
        >
          <span className="font-semibold">{d.c}</span>: {d.u.replace(/^https?:\/\//, "")}
        </a>
      ))}
      {docs.length === 0 && !open && <span className="text-muted-foreground">—</span>}
      {onAdd &&
        (open ? (
          <div className="flex flex-col gap-1">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border border-border rounded bg-background px-1 py-0.5"
            >
              {MAIL_DOC_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mail.google.com/..."
              className="border border-border rounded bg-background px-1 py-0.5"
            />
            <div className="flex gap-1">
              <button
                type="button"
                disabled={busy || !url.trim()}
                onClick={save}
                className="rounded border border-border px-2 py-0.5 font-semibold hover:bg-muted/60 disabled:opacity-50"
              >
                Save
              </button>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-0.5 text-muted-foreground">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 self-start text-muted-foreground hover:text-foreground"
          >
            <Plus size={12} /> Add link
          </button>
        ))}
    </div>
  );
}
