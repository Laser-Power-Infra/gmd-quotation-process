/**
 * Scheduled job — Sync health alert, daily at 10:00 IST (Puja, 10 Nov 2026, interlinking D11:
 * "alert if any page has not synced for 24 h").
 *
 * Reads every job's heartbeat (`job-heartbeat.ts`) and mails the STALE (no successful
 * run in 24 h) and NEVER rows to SYNC_ALERT_TO, a comma-separated list. When it is
 * unset, or nothing is stale, no mail is sent; the run only logs. The same rows are
 * listed on /data-sources.
 */

import { sendPbgMail } from "@/lib/services/mailer";
import { istTime, readSyncHealth, recordJobRun, type SyncHealthRow } from "./job-heartbeat";
import { JobAlreadyRunningError } from "./run-gmd-update";

const JOB = "sync-health";

export type SyncHealthMail = { to: string[]; subject: string; text: string; html: string };

export type ScheduledSyncHealthResult = {
  success: boolean;
  job: typeof JOB;
  startedAt: string;
  elapsedMs: number;
  health: SyncHealthRow[];
  mailed: boolean;
  error?: string;
};

const recipients = (alertTo: string | undefined) => (alertTo ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The alert for these rows, or null when there is nobody to tell or nothing to say. */
export function syncHealthAlert(rows: SyncHealthRow[], alertTo: string | undefined): SyncHealthMail | null {
  const to = recipients(alertTo);
  // Its own last run is ~24 h old whenever it runs, so it never reports itself.
  const bad = rows.filter((r) => r.status !== "OK" && r.job !== JOB);
  if (to.length === 0 || bad.length === 0) return null;
  const lines = bad.map((r) =>
    r.lastRun
      ? `${r.job}: STALE, last successful run ${istTime(r.lastRun)} IST (${r.ageHours?.toFixed(1)} h ago)`
      : `${r.job}: NEVER, no successful run recorded`,
  );
  const intro = `${bad.length} scheduled job(s) have not run successfully in the last 24 hours:`;
  const outro = "The full list is under Sync Health on the Data Sources page.";
  return {
    to,
    subject: `Sync health: ${bad.length} job(s) not synced in 24 hours`,
    text: [intro, ...lines.map((l) => `- ${l}`), "", outro].join("\n"),
    html: `<p>${intro}</p><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p>${outro}</p>`,
  };
}

let inFlight = false;

export async function runScheduledSyncHealth(): Promise<ScheduledSyncHealthResult> {
  if (inFlight) throw new JobAlreadyRunningError(JOB);
  inFlight = true;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  try {
    console.log(`\n########## [SCHEDULER] ${JOB} start ${startedAt} ##########`);
    const health = await readSyncHealth(new Date(startedAtMs));
    const mail = syncHealthAlert(health, process.env.SYNC_ALERT_TO);
    const sent = mail ? await sendPbgMail(mail) : null;
    const success = !sent || sent.ok;

    console.log(
      `[scheduler] ${JOB} ${health.map((r) => `${r.job}=${r.status}`).join(" ")} — ` +
        (mail
          ? `mail to ${mail.to.join(", ")}: ${sent?.ok ? "sent" : `FAILED ${sent?.error}`}`
          : `no mail (${recipients(process.env.SYNC_ALERT_TO).length ? "nothing stale" : "SYNC_ALERT_TO unset"})`),
    );
    if (success) await recordJobRun(JOB);
    const elapsedMs = Date.now() - startedAtMs;
    console.log(`########## [SCHEDULER] ${JOB} done in ${elapsedMs}ms ##########\n`);
    return { success, job: JOB, startedAt, elapsedMs, health, mailed: Boolean(sent?.ok), error: sent?.error };
  } finally {
    inFlight = false;
  }
}
