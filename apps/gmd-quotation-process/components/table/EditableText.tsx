"use client";

import { useRef, useState } from "react";

/**
 * A cell value that is plain text until clicked, then an input (commit on blur/Enter,
 * Esc cancels). A page of ~900 always-mounted inputs was the main DOM cost of the table.
 * `className` styles both states, so text alignment and colour carry over.
 */
export default function EditableText({
  value,
  onCommit,
  className = "",
  disabled = false,
  readOnly = false,
  title,
  placeholder = "-",
  onPaste,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  title?: string;
  placeholder?: string;
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false); // Esc must not commit through the blur that follows

  if (!editing) {
    const locked = disabled || readOnly;
    return (
      <span
        tabIndex={locked ? undefined : 0}
        title={title ?? (value || undefined)}
        onClick={() => {
          if (locked) return;
          cancelled.current = false;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !locked) {
            cancelled.current = false;
            setEditing(true);
          }
        }}
        className={`block min-h-6 truncate ${locked ? "cursor-default" : "cursor-text hover:bg-muted/80"} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
      >
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  }

  return (
    <input
      type="text"
      autoFocus
      defaultValue={value}
      placeholder={placeholder}
      onPaste={onPaste}
      onBlur={(e) => {
        setEditing(false);
        if (!cancelled.current) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
      className={`w-full outline-none ring-1 ring-blue-500 bg-accent ${className}`}
    />
  );
}
