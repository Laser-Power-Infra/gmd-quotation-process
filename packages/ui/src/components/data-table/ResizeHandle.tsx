"use client";

import { useRef, type PointerEvent } from "react";

interface ResizeHandleProps {
  /** Width to resize from; the header cell is read for its live width. */
  min?: number;
  /** Called with the new width on every pointer move (apply it to the DOM) and once more on release (commit). */
  onResize: (width: number, final: boolean) => void;
  onReset?: () => void;
  label: string;
}

/** Column edge grip: drag follows the pointer 1:1 (captured), double-click resets. */
export function ResizeHandle({ min = 60, onResize, onReset, label }: ResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const widthAt = (e: PointerEvent, final: boolean) => {
    if (!start.current) return;
    onResize(Math.max(min, Math.round(start.current.width + e.clientX - start.current.x)), final);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width };
      }}
      onPointerMove={(e) => widthAt(e, false)}
      onPointerUp={(e) => {
        widthAt(e, true);
        start.current = null;
      }}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={onReset}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 z-10 flex h-full w-2 cursor-col-resize touch-none items-center justify-center opacity-0 transition-opacity duration-100 group-hover/th:opacity-100 hover:opacity-100 active:opacity-100 motion-reduce:transition-none"
    >
      <span className="h-4 w-px rounded-full bg-primary-foreground/40 group-hover/th:bg-primary-foreground/80" />
    </div>
  );
}
