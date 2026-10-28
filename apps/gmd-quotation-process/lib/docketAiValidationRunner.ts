/**
 * One-by-one AI verification for pending dockets.
 *
 * Rules:
 * - Only threads that pass the pending-docket candidate rules are eligible.
 * - A thread is never sent to the model after it has a `true`/`false` verdict.
 * - At most `MAX_ATTEMPTS` (3) model calls per thread. Errors leave the verdict
 *   `null` and store `aiValidationLastError`; the next trigger retries, spaced.
 * - Calls are serialised (one at a time) through a singleton queue and an
 *   atomic attempt claim, so concurrent triggers cannot double-call.
 */

import { prisma } from "@/lib/prisma";
import { isPendingDocketCandidate } from "@/lib/docketPending";
import {
  isDocketAiValidationEnabled,
  validateNewDocketWithAi,
} from "@/lib/docketAiValidator";
import { invalidatePendingDocketsCache } from "@/lib/pendingDocketsCache";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LIMIT = 100;

function maxAttempts(): number {
  const raw = Number(process.env.DOCKET_AI_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ATTEMPTS;
}

export function getDocketAiMaxAttempts(): number {
  return maxAttempts();
}

export interface DocketAiThreadInput {
  id: number;
  subject: string | null;
  body: string | null;
  bodyPreview: string | null;
  ocrText: string | null;
  docketNo?: string | null;
  duplicateOfDocket?: string | null;
  aiIsNewDocket?: boolean | null;
  aiValidationAttempts?: number | null;
  userLabels?: unknown;
  isGmdClient?: boolean | null;
  company?: string | null;
  toDetails?: unknown;
  ccDetails?: unknown;
}

export interface DocketAiVerdictRecord {
  id: number;
  isNewDocket: boolean;
}

export interface DocketAiValidationResult {
  /** Threads actually sent to the model in this run. */
  attempted: number;
  /** Verdicts persisted as `true`. */
  verifiedTrue: number;
  /** Verdicts persisted as `false`. */
  verifiedFalse: number;
  /** Threads skipped (decided, exhausted, over cap, or not candidates). */
  skipped: number;
  /** Model/DB failures (attempt counted, verdict left `null`). */
  errors: number;
  /** Per-thread true/false verdicts persisted in this run. */
  verdicts: DocketAiVerdictRecord[];
}

export interface DocketAiValidationOptions {
  /** Hard cap for this run. Default 100. */
  limit?: number;
}

/**
 * The single eligibility gate. A non-candidate thread can never reach the
 * model, even if its `aiIsNewDocket` is null.
 */
export function isDocketAiEligible(thread: DocketAiThreadInput): boolean {
  if (thread.aiIsNewDocket === true || thread.aiIsNewDocket === false) return false;
  if ((thread.aiValidationAttempts ?? 0) >= maxAttempts()) return false;
  if (thread.docketNo) return false;
  if (thread.duplicateOfDocket) return false;

  const text = `${thread.subject || ""} ${thread.body || ""} ${thread.bodyPreview || ""}`;
  return isPendingDocketCandidate({
    userLabels: thread.userLabels,
    isGmdClient: thread.isGmdClient,
    company: thread.company,
    toDetails: thread.toDetails,
    ccDetails: thread.ccDetails,
    text,
  });
}

type ValidateOutcome = "true" | "false" | "error" | "skipped";

/**
 * Validates one thread with an atomic attempt claim. Safe to call from the
 * queue and from the scheduler at the same time.
 */
async function validateOne(thread: DocketAiThreadInput): Promise<ValidateOutcome> {
  if (!isDocketAiValidationEnabled()) return "skipped";
  if (!isDocketAiEligible(thread)) return "skipped";

  const current = await prisma.docketQuotationThread.findUnique({
    where: { id: thread.id },
    select: {
      aiIsNewDocket: true,
      aiValidationAttempts: true,
      docketNo: true,
      duplicateOfDocket: true,
    },
  });

  if (!current) return "skipped";
  if (current.aiIsNewDocket !== null) return "skipped";
  if (current.docketNo || current.duplicateOfDocket) return "skipped";
  if (current.aiValidationAttempts >= maxAttempts()) return "skipped";

  // Optimistic claim: only the caller that observes the same counter value may
  // call the model. This caps the thread at exactly maxAttempts calls.
  const claimed = await prisma.docketQuotationThread.updateMany({
    where: {
      id: thread.id,
      aiIsNewDocket: null,
      aiValidationAttempts: current.aiValidationAttempts,
      docketNo: null,
      duplicateOfDocket: null,
    },
    data: { aiValidationAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "skipped";

  const result = await validateNewDocketWithAi({
    subject: thread.subject,
    body: thread.body,
    bodyPreview: thread.bodyPreview,
    ocrText: thread.ocrText,
  });

  if (result.ok) {
    await prisma.docketQuotationThread.update({
      where: { id: thread.id },
      data: {
        aiIsNewDocket: result.verdict.isNewDocket,
        aiValidationLastError: null,
      },
    });
    invalidatePendingDocketsCache();
    return result.verdict.isNewDocket ? "true" : "false";
  }

  await prisma.docketQuotationThread.update({
    where: { id: thread.id },
    data: { aiValidationLastError: result.error.slice(0, 500) },
  });
  return "error";
}

// ---------------------------------------------------------------------------
// Singleton background queue (page load / tab click). Strictly one at a time.
// ---------------------------------------------------------------------------

const queue: DocketAiThreadInput[] = [];
const queuedIds = new Set<number>();
let draining = false;
let drainLimit = DEFAULT_LIMIT;

function drainQueue() {
  if (draining) return;
  draining = true;

  void (async () => {
    let processed = 0;
    try {
      while (queue.length > 0 && processed < drainLimit) {
        const thread = queue.shift();
        if (!thread) break;
        queuedIds.delete(thread.id);
        processed++;
        try {
          await validateOne(thread);
        } catch (err) {
          console.warn(
            `[docketAiValidationRunner] queue item ${thread.id} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } finally {
      draining = false;
    }
  })();
}

/**
 * Adds eligible candidates to the background queue and starts the single
 * sequential worker. Returns immediately (no AI await).
 */
export function enqueueDocketAiValidation(
  threads: DocketAiThreadInput[],
  limit = DEFAULT_LIMIT,
): void {
  if (!isDocketAiValidationEnabled()) return;

  for (const thread of threads) {
    if (!isDocketAiEligible(thread)) continue;
    if (queuedIds.has(thread.id)) continue;
    queuedIds.add(thread.id);
    queue.push(thread);
  }

  if (queue.length === 0) return;
  drainLimit = Math.max(1, limit);
  drainQueue();
}

/**
 * Awaited sequential validation for the scheduler and the CLI backfill.
 * Shares the same per-thread claim as the queue, so it cannot double-call.
 */
export async function runDocketAiValidation(
  threads: DocketAiThreadInput[],
  options: DocketAiValidationOptions = {},
): Promise<DocketAiValidationResult> {
  const result: DocketAiValidationResult = {
    attempted: 0,
    verifiedTrue: 0,
    verifiedFalse: 0,
    skipped: 0,
    errors: 0,
    verdicts: [],
  };

  const eligible = threads.filter(isDocketAiEligible);
  result.skipped += threads.length - eligible.length;

  if (eligible.length === 0) return result;
  if (!isDocketAiValidationEnabled()) {
    result.skipped += eligible.length;
    return result;
  }

  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const batch = eligible.slice(0, limit);
  result.skipped += eligible.length - batch.length;

  for (const thread of batch) {
    const outcome = await validateOne(thread);
    if (outcome === "true") {
      result.attempted++;
      result.verifiedTrue++;
      result.verdicts.push({ id: thread.id, isNewDocket: true });
    } else if (outcome === "false") {
      result.attempted++;
      result.verifiedFalse++;
      result.verdicts.push({ id: thread.id, isNewDocket: false });
    } else if (outcome === "error") {
      result.attempted++;
      result.errors++;
    } else {
      result.skipped++;
    }
  }

  return result;
}
