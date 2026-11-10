"use client";

import type { Light } from "@/lib/executionPages";

export { TD, TDN, TH, Tile } from "@gmd/ui/components/plain-table";

const LIGHT_CLASS: Record<Light, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-600" };
const LIGHT_TEXT: Record<Light, string> = { green: "On track", amber: "Due soon", red: "Stuck / overdue" };

export function Dot({ light, days }: { light: Light; days: number | null }) {
  return (
    <span title={`${LIGHT_TEXT[light]}${days === null ? "" : ` (${days} days since contract)`}`} className={`inline-block h-2.5 w-2.5 rounded-full ${LIGHT_CLASS[light]}`} />
  );
}

/** Header cell with the short form explained on hover. */
export function Abbr({ text, hint }: { text: string; hint?: string }) {
  return hint ? <span title={hint} className="cursor-help underline decoration-dotted">{text}</span> : <>{text}</>;
}
