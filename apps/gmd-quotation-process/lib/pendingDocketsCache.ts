/**
 * Short-lived cache for the Pending Dockets response.
 *
 * Stored on `globalThis` so it survives Next.js dev HMR / per-request module
 * re-evaluation in the same process. The cache keeps auto-poll and refreshes
 * fast, and remembers which threads were eligible for AI so a cache hit can
 * still kick the background queue.
 */

import type { DocketAiThreadInput } from "@/lib/docketAiValidationRunner";

export interface PendingDocketsResponse {
  summary: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
}

export interface PendingDocketsCacheEntry {
  at: number;
  response: PendingDocketsResponse;
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

export function setPendingDocketsCache(
  response: PendingDocketsResponse,
  candidates: DocketAiThreadInput[],
): void {
  store().__gmdPendingDocketsCache = { at: Date.now(), response, candidates };
}

export function invalidatePendingDocketsCache(): void {
  store().__gmdPendingDocketsCache = null;
}
