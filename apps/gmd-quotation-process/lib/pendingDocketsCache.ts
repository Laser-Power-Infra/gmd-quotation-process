/**
 * Short-lived cache of the Pending Dockets set (lib/pendingDocketsScope).
 *
 * Stored on `globalThis` so it survives Next.js dev HMR / per-request module
 * re-evaluation in the same process. The cache keeps paging, facets and the
 * auto-poll fast, and remembers which threads were eligible for AI so a cache
 * hit can still kick the background queue.
 */

import type { DocketAiThreadInput } from "@/lib/docketAiValidationRunner";
import type { PendingScope } from "@gmd/pending-dockets/columns";

export interface PendingDocketsCacheEntry {
  at: number;
  scope: PendingScope;
  candidates: DocketAiThreadInput[];
}

type CacheGlobal = typeof globalThis & {
  __gmdPendingDocketsCache?: PendingDocketsCacheEntry | null;
};

function store(): CacheGlobal {
  return globalThis as CacheGlobal;
}

function ttlMs(): number {
  const raw = Number(process.env.PENDING_DOCKETS_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 10_000;
}

export function getPendingDocketsCache(): PendingDocketsCacheEntry | null {
  const entry = store().__gmdPendingDocketsCache;
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs()) {
    store().__gmdPendingDocketsCache = null;
    return null;
  }
  return entry;
}

export function setPendingDocketsCache(scope: PendingScope, candidates: DocketAiThreadInput[]): void {
  store().__gmdPendingDocketsCache = { at: Date.now(), scope, candidates };
}

export function invalidatePendingDocketsCache(): void {
  store().__gmdPendingDocketsCache = null;
}
