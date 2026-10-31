"use client";
import { useEffect, useState } from "react";
import { getUtilityDefaultStatesAction } from "@/app/actions/misc";

// One fetch per page load, shared by every dialog instance.
let cached: Promise<Record<string, string>> | null = null;

/** Utility -> master default state, for auto-filling a blank State. */
export function useUtilityDefaultStates(): Record<string, string> {
  const [states, setStates] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (cached ??= getUtilityDefaultStatesAction().catch(() => {
      cached = null;
      return {};
    })).then((s) => alive && setStates(s));
    return () => {
      alive = false;
    };
  }, []);
  return states;
}
