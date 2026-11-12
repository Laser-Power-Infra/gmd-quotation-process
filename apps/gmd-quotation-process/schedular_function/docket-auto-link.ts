/**
 * Scheduled job — Docket auto-link, nightly at 01:40 (Puja, 10 Nov 2026, interlinking A1).
 *
 * Fills the Quotations page Contract column (`Enquiry.selectedContractNo`) without
 * the Match button, for the clear-cut case only: a live contract no docket carries
 * yet, and exactly one docket of its party with the contract's total qty on every
 * one of its item codes. `planAutoLinks` decides every contract against the
 * start-of-run state; contracts contesting one docket link only as a genuine split.
 * Ambiguous and partial matches are counted and left to the button.
 *
 * Writes ONLY the link (`linkContractsToDocket`, shared with the button), added to
 * what the docket carries, never replacing or removing one. Quoted rates are never
 * touched: applying the contract rate stays a deliberate Match click, so a rate
 * mismatch is still there to flag (D1). Contract Review State / Utility follow the
 * link at the next hourly contract-review run.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import { groupLinesByContract, normalizeContractKey, normalizeParty, planAutoLinks } from "@/lib/contractDocketMatch";
import { docketsOfParties, linkContractsToDocket } from "@/lib/contractDocketLink";
import { isLiveStatus } from "@/lib/indentListingLiveFilter";
import { JobAlreadyRunningError } from "./run-gmd-update";
import { recordJobRun } from "./job-heartbeat";

export type JobName = "docket-auto-link";

export type DocketAutoLinkCounts = {
  /** Live contracts (a line with blank STATUS), the ones the Match dialog lists. */
  examined: number;
  linked: number;
  /** Two or more dockets match fully, or the one full match is a docket other contracts also pick and it is not a split between them (`planAutoLinks`). */
  ambiguous: number;
  /** No docket matches every code and qty, including no candidate docket at all. */
  partial: number;
  /** A docket already carries the contract. */
  alreadyLinked: number;
  /** A full match whose link write failed; the next run tries it again. */
  failed: number;
};

export type ScheduledDocketAutoLinkResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    autoLink?: DocketAutoLinkCounts;
  };
};

const inFlight = new Set<JobName>();

async function autoLinkContracts(): Promise<DocketAutoLinkCounts> {
  const rows = await tenderPrisma.contractReview.findMany({
    select: { contractNo: true, itemCode: true, size: true, orderQty: true, rate: true, partyNameDump: true, status: true },
  });
  const linesByContract = groupLinesByContract(rows);
  const contracts = new Map<string, { contractNo: string; live: boolean; parties: Set<string> }>();
  for (const r of rows) {
    const k = normalizeContractKey(r.contractNo);
    if (!k) continue;
    const c = contracts.get(k) ?? { contractNo: r.contractNo.trim(), live: false, parties: new Set<string>() };
    c.live ||= isLiveStatus(r.status);
    const party = normalizeParty(r.partyNameDump);
    if (party) c.parties.add(party);
    contracts.set(k, c);
  }
  const live = [...contracts].filter(([, c]) => c.live).sort(([a], [b]) => a.localeCompare(b));

  const carried = await prisma.enquiry.findMany({
    where: { selectedContractNo: { isEmpty: false } },
    select: { selectedContractNo: true },
  });
  const linked = new Set(carried.flatMap((e) => e.selectedContractNo.map(normalizeContractKey)));

  const dockets = await docketsOfParties(new Set(live.filter(([k]) => !linked.has(k)).flatMap(([, c]) => [...c.parties])));
  const byParty = new Map<string, typeof dockets>();
  for (const d of dockets) {
    const p = normalizeParty(d.partyName);
    byParty.set(p, [...(byParty.get(p) ?? []), d]);
  }

  const toDecide = live.map(([, c]) => ({ contractNo: c.contractNo, dockets: [...c.parties].flatMap((p) => byParty.get(p) ?? []) }));
  const picks = planAutoLinks(toDecide, linesByContract, linked);

  const counts: DocketAutoLinkCounts = { examined: live.length, linked: 0, ambiguous: 0, partial: 0, alreadyLinked: 0, failed: 0 };
  // shortcut: links are written one by one inside the request; move to the planned RabbitMQ worker if a run nears maxDuration.
  for (const [i, pick] of picks.entries()) {
    if (pick.outcome !== "linked") {
      counts[pick.outcome]++;
      continue;
    }
    const { contractNo } = toDecide[i];
    try {
      const link = await linkContractsToDocket(pick.docketId, [contractNo]);
      counts.linked++;
      console.log(`[docket-auto-link] ${contractNo} -> ${link.docketNumber}`);
    } catch (e) {
      counts.failed++;
      console.warn(`[docket-auto-link] ${contractNo} -> enquiry ${pick.docketId} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return counts;
}

export async function runScheduledDocketAutoLink(): Promise<ScheduledDocketAutoLinkResult> {
  const job: JobName = "docket-auto-link";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledDocketAutoLinkResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    const counts = await autoLinkContracts();
    steps.autoLink = counts;

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `examined=${counts.examined} linked=${counts.linked} ambiguous=${counts.ambiguous} ` +
        `partial=${counts.partial} alreadyLinked=${counts.alreadyLinked} failed=${counts.failed}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);
    await recordJobRun(job, counts.examined);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next run.
    inFlight.delete(job);
  }
}
