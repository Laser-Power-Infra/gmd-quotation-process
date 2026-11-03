/**
 * AI verification for the Pending Dockets tab.
 *
 * Classifies a mail thread as a genuine *new docket* request or not. The
 * verdict is stored on `DocketQuotationThread.aiIsNewDocket` and is never
 * recomputed once set (see `docketAiValidationRunner.ts`).
 *
 * This module uses its own dedicated key, `DOCKET_AI_API_KEY`, so the docket
 * verification quota is isolated from the other OpenAI usages in the app.
 * When the key is missing (or `DOCKET_AI_VALIDATION_ENABLED=false`) the
 * validator returns `null`, which the UI renders as "Not verified".
 */

import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const DEFAULT_MODEL = "gpt-6-luna";

export type DocketAiConfidence = "high" | "medium" | "low";

export interface DocketAiVerdict {
  isNewDocket: boolean;
  confidence: DocketAiConfidence;
  reason: string;
}

export type DocketAiCallResult =
  | { ok: true; verdict: DocketAiVerdict }
  | { ok: false; error: string; disabled?: boolean };

export interface DocketAiInput {
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  ocrText?: string | null;
}

const verdictSchema = z.object({
  isNewDocket: z
    .boolean()
    .describe(
      "True when the thread still needs a NEW GMD docket: an explicit request to create a docket, or a new customer enquiry/RFQ with no GMD docket number in the thread. False when a GMD docket already exists or the mail is not an enquiry.",
    ),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z
    .string()
    .describe("One short sentence: the rule number applied and the evidence, max 240 characters."),
});

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truncate(value: string | null | undefined, maxChars: number): string {
  const text = (value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

/** Dedicated key for docket verification only. Empty disables the feature. */
export function getDocketAiApiKey(): string {
  return (process.env.DOCKET_AI_API_KEY ?? "").trim();
}

export function isDocketAiValidationEnabled(): boolean {
  const flag = (process.env.DOCKET_AI_VALIDATION_ENABLED ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return !!getDocketAiApiKey();
}

/**
 * Fits a mail thread into maxChars without losing any message. Threads are
 * stored as "--- Message N From: X ---" blocks; a plain head cut dropped the
 * last messages, where the team writes "please create docket" or Laser Entry
 * replies "Please refer-GMD/2026-27/585". Each message keeps its opening lines
 * (where that text is); the first message, the customer enquiry, gets a larger
 * share. Text without markers falls back to head + tail.
 */
export function compactThread(value: string | null | undefined, maxChars: number): string {
  const text = (value ?? "").trim();
  if (text.length <= maxChars) return text;
  const parts = text.split(/(?=---\s*Message\s*\d+\s*From:)/i).filter((p) => p.trim());
  if (parts.length < 2) {
    const head = Math.floor(maxChars * 0.4);
    return `${text.slice(0, head)}\n...[middle omitted]...\n${text.slice(-(maxChars - head))}`;
  }
  const firstBudget = Math.floor(maxChars * 0.35);
  const restBudget = Math.max(200, Math.floor((maxChars - firstBudget) / (parts.length - 1)));
  const cut = (p: string, n: number) => (p.length <= n ? p.trim() : `${p.slice(0, n).trim()} ...[cut]`);
  return parts.map((p, i) => cut(p, i === 0 ? firstBudget : restBudget)).join("\n");
}

/**
 * Builds the bounded model input: subject + body (or first-message preview when
 * the body is absent) + attachment OCR, each truncated independently so a huge
 * thread cannot blow up the prompt. The body keeps every message (see compactThread).
 */
export function buildDocketAiInput(input: DocketAiInput): string {
  const subject = truncate(input.subject, envInt("DOCKET_AI_MAX_SUBJECT_CHARS", 500));
  const bodySource =
    input.body && input.body.trim() ? input.body : input.bodyPreview;
  const body = compactThread(bodySource, envInt("DOCKET_AI_MAX_BODY_CHARS", 6000));
  const ocr = truncate(input.ocrText, envInt("DOCKET_AI_MAX_OCR_CHARS", 3000));

  const parts: string[] = [];
  if (subject) parts.push(`SUBJECT:\n${subject}`);
  if (body) parts.push(`THREAD (oldest message first, "--- Message N From: ... ---" separates messages):\n${body}`);
  if (ocr) parts.push(`ATTACHMENT OCR:\n${ocr}`);
  return parts.join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `You classify one email thread from GMD's quotation inbox. GMD (gmdalui.co.in) and Laser Power & Infra (laserpowerinfra.com, laserentry.*, enquiry5.*, lasertender.*) are the SAME internal team. Laser Entry is the desk that creates dockets.

Question: does this thread still need a NEW GMD docket (an enquiry/quotation file numbered like GMD/2026-27/589) to be created?

Decide in this order and stop at the first rule that applies:

1. Docket already exists -> false.
   A GMD docket number (GMD/yyyy-yy/n, GMD-nnnn) or "Docket No: <number>" appears anywhere in the thread, e.g. Laser Entry replied with the number.
   NOT a docket number: GeM bid numbers (GEM/2026/B/8168518), e-procurement IDs (2026_WBSED_123456_1), RFQ / RFX / PR / tender numbers. These identify the customer's enquiry and do not mean a docket exists.

2. Explicit docket request -> true.
   Anyone, including an internal team member, asks to create a docket: "please create docket", "kindly create a docket for ...", "create docket against GEM/...", typos like "create dockte". This holds even when the subject starts with Re:/Fwd:, the customer's part is a reminder, or the requester is internal.

3. New customer enquiry -> true.
   An external customer asks for prices for goods or services and nothing shows the quotation was already sent: RFQ, enquiry/inquiry, request for quotation / offer / budgetary or best rates, tender enquiry with an item list. A Fwd of such an enquiry to the team also counts.

4. Otherwise -> false. That covers:
   - replies about an existing offer: price negotiation, technical clarification, revised offer, "quotation attached", "find our offer";
   - customer purchase orders, work orders, LOA / LOI, dispatch, inspection, payment, accounts, logistics, ERP or report mail;
   - tender alerts, newsletters, auto-notifications, bounces, spam;
   - internal chatter with no request to quote.

Judge the thread as it stands now; the LATEST messages show whether a docket was requested or already given. Use attachment OCR only as supporting evidence.

Confidence: high = a rule clearly matched; medium = some inference needed; low = unclear text.
Reason: one short sentence naming the rule number and the evidence, e.g. "Rule 2: Puja asks Laser Entry to create a docket for the SAIL RFX enquiry."`;

/**
 * Runs the AI check for one thread. Never throws: returns a discriminated
 * result so the caller can store the error and decide whether to retry.
 */
export async function validateNewDocketWithAi(
  input: DocketAiInput,
): Promise<DocketAiCallResult> {
  if (!isDocketAiValidationEnabled()) {
    return { ok: false, error: "AI validation is disabled", disabled: true };
  }

  const prompt = buildDocketAiInput(input);
  if (!prompt.trim()) {
    return { ok: false, error: "No subject/body/OCR text to validate" };
  }

  try {
    const openai = createOpenAI({ apiKey: getDocketAiApiKey() });
    const result = await generateText({
      model: openai(process.env.DOCKET_AI_MODEL || DEFAULT_MODEL),
      output: Output.object({ schema: verdictSchema }),
      system: SYSTEM_PROMPT,
      prompt,
    });

    const output = result.output;
    if (!output) {
      return { ok: false, error: "Model returned no structured output" };
    }

    return {
      ok: true,
      verdict: {
        isNewDocket: !!output.isNewDocket,
        confidence: output.confidence ?? "low",
        reason: (output.reason ?? "").slice(0, 240),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[docketAiValidator] validation failed: ${message}`);
    return { ok: false, error: message };
  }
}
