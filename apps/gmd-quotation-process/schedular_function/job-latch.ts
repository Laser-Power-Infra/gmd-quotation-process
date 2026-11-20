/**
 * In-flight latch shared by each scheduled job and every manual Sync entry point
 * that runs the same writes, keyed by job name ("bom-mast", "contract-review",
 * "pbg", ...). BomItem, ContractReview and PbgData have no unique key, so two
 * overlapping runs would both insert the same new rows; a second caller is
 * refused instead of queued.
 *
 * No imports on purpose: lib/ and Server Action modules can use it without
 * pulling in a scheduled job.
 */

/** Thrown when a job is asked to run while an earlier run of the same job is still in flight. */
export class JobAlreadyRunningError extends Error {
  constructor(job: string) {
    super(`Job "${job}" is already running.`);
    this.name = "JobAlreadyRunningError";
  }
}

// shortcut: in-process latch, valid for one app instance; move to a DB/advisory lock if the app is ever scaled out
// On globalThis so a route handler and a Server Action share one set even if Next bundles this module twice.
const holder = globalThis as unknown as { gmdRunningJobs?: Set<string> };
export const runningJobs: Set<string> = (holder.gmdRunningJobs ??= new Set<string>());

/** Runs `run` holding `job`'s latch, released however `run` ends. */
export async function withJobLatch<T>(job: string, run: () => Promise<T>): Promise<T> {
  if (runningJobs.has(job)) throw new JobAlreadyRunningError(job);
  runningJobs.add(job);
  try {
    return await run();
  } finally {
    runningJobs.delete(job);
  }
}

/** What a refused manual Sync tells the user. */
export const busyMessage = (name: string) =>
  `${name} sync is already running. Try again in a few minutes.`;
