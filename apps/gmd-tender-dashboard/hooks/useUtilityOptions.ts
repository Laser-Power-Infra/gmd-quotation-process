"use client";
import { useEffect, useState } from "react";
import { getUtilityOptionsAction } from "@/actions/utility";

// One fetch per page load, shared by every page with a utility filter.
let cached: Promise<string[]> | null = null;

/** Standard utility names (LookupOption UTILITY), A→Z. Empty until loaded, or if the load fails. */
export function useUtilityOptions(): string[] {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (cached ??= getUtilityOptionsAction().catch((err) => {
      console.error("Failed to load the utility options:", err);
      cached = null;
      return [];
    })).then((o) => alive && setOptions(o));
    return () => {
      alive = false;
    };
  }, []);
  return options;
}
