"use client";

/** Indeterminate 2px sweep across the top of its container while `active`; content underneath stays put. */
export function LoadingBar({ active }: { active: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden">
      <style>{`@keyframes gmd-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      <div
        className="h-full w-1/3 rounded-full bg-primary transition-opacity duration-200 motion-reduce:animate-none"
        style={{
          opacity: active ? 1 : 0,
          animation: active ? "gmd-sweep 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite" : "none",
        }}
      />
    </div>
  );
}
