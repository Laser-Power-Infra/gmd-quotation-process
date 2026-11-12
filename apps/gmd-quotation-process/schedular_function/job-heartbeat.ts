/**
 * Job heartbeats, behind the Sync Health list on /data-sources and the daily
 * `sync-health` alert (Puja, 10 Nov 2026, interlinking D11).
 *
 * Every scheduled job calls `recordJobRun` once, at the end of a successful run.
 * It upserts the EngineeringSync row `job:<name>` (the table already holds one
 * timestamp per key, so no table of its own). A failed run writes nothing, so its
 * last good run ages into STALE.
 */

import { isSyncStale } from "@gmd/dashboard/lib/syncStale";
import { prisma } from "@/lib/prisma";

/** Every scheduled job: one per `infra/*.conf`, plus pbg-reminders (wired from the repo-root infra/). */
export const SYNC_JOBS = [
  "acc-master",
  "bom-mast",
  "c-batch",
  "closure-status",
  "contract-review",
  "docket-auto-link",
  "docket-creation",
  "docket-followup",
  "erp-contract-no",
  "execution-tracking",
  "ledger",
  "pbg",
  "pbg-reminders",
  "physical-stock-cost-bom",
  "purchase-orders",
  "raw-material",
  "service-orders",
  "supply-history",
  "sync-health",
] as const;

export type SyncJob = (typeof SYNC_JOBS)[number];

export type SyncHealthRow = {
  job: string;
  lastRun: Date | null;
  ageHours: number | null;
  status: "OK" | "STALE" | "NEVER";
};

const KEY = "job:";

/** Stamps a successful run. Never throws: a failed heartbeat write must not fail the job. */
export async function recordJobRun(job: SyncJob, totalRows = 0): Promise<void> {
  const tabKey = KEY + job;
  const syncedAt = new Date();
  try {
    await prisma.engineeringSync.upsert({
      where: { tabKey },
      create: { tabKey, syncedAt, totalRows },
      update: { syncedAt, totalRows },
    });
  } catch (err) {
    console.error(`[job-heartbeat] ${job}: could not record the run: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One row per job: NEVER without a heartbeat, STALE after 24 h (the shared syncStale rule), else OK. */
export function syncHealthOf(rows: { tabKey: string; syncedAt: Date }[], jobs: readonly string[], now: Date): SyncHealthRow[] {
  const last = new Map(rows.map((r) => [r.tabKey, r.syncedAt]));
  return jobs.map((job) => {
    const lastRun = last.get(KEY + job);
    if (!lastRun) return { job, lastRun: null, ageHours: null, status: "NEVER" };
    const status = isSyncStale(lastRun, now.getTime()) ? "STALE" : "OK";
    return { job, lastRun, ageHours: (now.getTime() - lastRun.getTime()) / 3_600_000, status };
  });
}

export async function readSyncHealth(now = new Date()): Promise<SyncHealthRow[]> {
  const rows = await prisma.engineeringSync.findMany({
    where: { tabKey: { startsWith: KEY } },
    select: { tabKey: true, syncedAt: true },
  });
  return syncHealthOf(rows, SYNC_JOBS, now);
}

/** e.g. "10 Nov 2026, 09:00 am", in IST whatever the server's timezone. */
export const istTime = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
