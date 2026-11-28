/**
 * Scheduled job — RawMaterial.cost -> ready-stock prices on the GM Dalui website.
 *
 * The website (gmd-dashboard-website, /purchase) lists ~900 stock items keyed by
 * ERP item code. Their price is this table's `cost` (rupees) for the same
 * `erpItemCode`. The website's database is on Neon while this one is on the
 * office network, so the website cannot read it - this job pushes instead.
 *
 * Every run sends a FULL snapshot: every RawMaterial row with an erpItemCode and
 * its cost (null when empty). The website prices matched items, and treats a
 * null/0 cost or a missing code as "Price on request" - the same "not priced
 * yet" meaning the in-app cost lookup gives null/0. Read-only on this side.
 *
 * Website endpoint: POST /api/purchase-prices/sync (x-api-key gated).
 *   WEBSITE_PRICE_SYNC_URL      full URL of that endpoint
 *   WEBSITE_PRICE_SYNC_API_KEY  must equal PRICE_SYNC_API_KEY on the website
 *
 * Scheduled hourly at :55, after the other hourly jobs, so it carries any cost
 * a user set on /raw_material during the hour.
 */

import { prisma } from "@/lib/prisma";
import { JobAlreadyRunningError } from "./run-gmd-update";
import { recordJobRun } from "./job-heartbeat";

export type JobName = "website-prices";

export type CostSnapshotEntry = { erpItemCode: string; cost: number | null };

/** What the website reports back after applying the snapshot. */
export type WebsitePriceSyncResponse = {
  ok: true;
  total: number;
  priced: number;
  onRequest: number;
  changed: number;
  received: number;
};

export type ScheduledWebsitePricesResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  sent: number;
  website: WebsitePriceSyncResponse;
};

/**
 * Pure: rows -> snapshot. Trims codes, drops blank ones, and turns the Prisma
 * Decimal into a plain number (null stays null). One entry per code - the
 * column is unique, but trimming could fold two spellings, so the first wins.
 */
export function buildCostSnapshot(
  rows: { erpItemCode: string | null; cost: { toString(): string } | number | null }[],
): CostSnapshotEntry[] {
  const seen = new Set<string>();
  const out: CostSnapshotEntry[] = [];
  for (const row of rows) {
    const code = row.erpItemCode?.trim();
    if (!code || seen.has(code.toUpperCase())) continue;
    seen.add(code.toUpperCase());
    const cost = row.cost == null ? null : Number(row.cost.toString());
    out.push({ erpItemCode: code, cost: cost != null && Number.isFinite(cost) && cost >= 0 ? cost : null });
  }
  return out;
}

const inFlight = new Set<JobName>();

export async function runScheduledWebsitePrices(): Promise<ScheduledWebsitePricesResult> {
  const job: JobName = "website-prices";
  const url = process.env.WEBSITE_PRICE_SYNC_URL;
  const key = process.env.WEBSITE_PRICE_SYNC_API_KEY;
  if (!url || !key) {
    throw new Error("WEBSITE_PRICE_SYNC_URL / WEBSITE_PRICE_SYNC_API_KEY are not set");
  }

  if (inFlight.has(job)) throw new JobAlreadyRunningError(job);
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    const rows = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { not: null } },
      select: { erpItemCode: true, cost: true },
    });
    const costs = buildCostSnapshot(rows);
    // An empty snapshot would turn every website price into "on request"; the
    // website refuses it too, but fail here with the clearer reason.
    if (costs.length === 0) throw new Error("RawMaterial has no item codes - nothing to send");

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ costs }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Website rejected the price push: ${res.status} ${text.slice(0, 300)}`);
    const website = JSON.parse(text) as WebsitePriceSyncResponse;

    const elapsedMs = Date.now() - startedAtMs;
    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — sent=${costs.length} ` +
        `priced=${website.priced} onRequest=${website.onRequest} changed=${website.changed}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);
    await recordJobRun(job, costs.length);

    return { success: true, job, startedAt, elapsedMs, sent: costs.length, website };
  } finally {
    inFlight.delete(job);
  }
}
