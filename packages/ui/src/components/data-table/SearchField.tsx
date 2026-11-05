"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";

interface SearchFieldProps {
  /** Committed value (what the server last searched for). */
  value: string;
  onCommit: (value: string) => void;
  /** Quiet time before a draft is committed. */
  delay?: number;
  /** Server round-trip in flight. */
  busy?: boolean;
  placeholder?: string;
  className?: string;
}

/** Echoes keystrokes instantly, commits after `delay` ms of silence; Esc clears at once. */
export function SearchField({ value, onCommit, delay = 1000, busy, placeholder = "Search", className }: SearchFieldProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // External change (Clear all): adopt it without firing a commit.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      onCommit(draft);
    }, delay);
    return () => clearTimeout(timer);
  }, [draft, delay, onCommit]);

  const clear = () => {
    committed.current = "";
    setDraft("");
    onCommit("");
  };
  const pending = draft !== committed.current || busy;

  return (
    <label className={cn("group relative flex h-8 w-64 items-center", className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full rounded-lg border border-input bg-background pr-8 pl-8 text-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none [&::-webkit-search-cancel-button]:hidden dark:bg-input/30"
      />
      <span className="absolute right-2 flex size-5 items-center justify-center">
        {pending ? (
          <Loader2 size={13} className="animate-spin text-muted-foreground" aria-label="Searching" />
        ) : draft ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <X size={12} />
          </button>
        ) : null}
      </span>
    </label>
  );
}
