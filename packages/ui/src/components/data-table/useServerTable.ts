"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FacetEntry {
  values: string[];
  /** Filter signature the options were computed for. */
  key: string;
}

export interface UseServerTableOptions<TPage> {
  /** Changes on every filter/page/sort change - triggers a load. */
  queryKey: string;
  /** Filters only - used to keep facet options fresh. */
  filterKey: string;
  /**
   * Signature a column's facet depends on; defaults to `filterKey`. Return the
   * filters minus that column's own, so picking a value does not reload its list.
   */
  facetKey?: (key: string) => string;
  fetchPage: () => Promise<TPage>;
  fetchFacet: (key: string) => Promise<string[]>;
}

/**
 * One filtered/sorted page at a time, with a race guard and a lazy facet cache.
 * `fetchPage`/`fetchFacet` are read through a ref so the caller can build them
 * inline without re-triggering the load effect.
 */
export function useServerTable<TPage>({ queryKey, filterKey, facetKey, fetchPage, fetchFacet }: UseServerTableOptions<TPage>) {
  const [data, setData] = useState<TPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Record<string, FacetEntry>>({});

  const requestRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);
  const handlersRef = useRef({ fetchPage, fetchFacet, filterKey, facetKey });
  const facetsRef = useRef(facets);

  useEffect(() => {
    handlersRef.current = { fetchPage, fetchFacet, filterKey, facetKey };
  }, [fetchPage, fetchFacet, filterKey, facetKey]);
  const keyFor = (key: string) => handlersRef.current.facetKey?.(key) ?? handlersRef.current.filterKey;
  useEffect(() => {
    facetsRef.current = facets;
  }, [facets]);

  const load = useCallback(async (background: boolean) => {
    const requestId = ++requestRef.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await handlersRef.current.fetchPage();
      if (requestId !== requestRef.current) return;
      setData(page);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Query changes refresh in the background: the previous page stays on screen.
  useEffect(() => {
    if (loadedKeyRef.current === queryKey) return;
    const first = loadedKeyRef.current === null;
    loadedKeyRef.current = queryKey;
    void load(!first);
  }, [queryKey, load]);

  const refresh = useCallback(() => load(true), [load]);

  const requestFacet = useCallback(async (key: string) => {
    const signature = keyFor(key);
    const entry = facetsRef.current[key];
    if (entry && entry.key === signature) return;
    try {
      const values = await handlersRef.current.fetchFacet(key);
      // The filters this list depends on changed while the request was in flight.
      if (keyFor(key) !== signature) return;
      setFacets((prev) => ({ ...prev, [key]: { values, key: signature } }));
    } catch {
      // Keep whatever options are already on screen.
    }
  }, []);

  const getFacetOptions = useCallback(
    (key: string) => {
      const signature = facetKey?.(key) ?? filterKey;
      return facets[key]?.key === signature ? facets[key].values : null;
    },
    [facets, filterKey, facetKey],
  );

  return { data, setData, loading, refreshing, error, getFacetOptions, requestFacet, refresh };
}
