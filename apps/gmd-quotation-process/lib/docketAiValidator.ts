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
      "True only when this mail is a genuine customer enquiry that requires a NEW docket number to be created. False for replies, internal/team mail, logistics/accounts/tender-only mail, spam, or mail that already carries an existing docket number.",
    ),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z
    .string()
    .describe("One short sentence explaining the decision, max 240 characters."),
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
 * Builds the bounded model input: subject + body (or first-message preview when
 * the body is absent) + attachment OCR, each truncated independently so a huge
 * thread cannot blow up the prompt.
 */
export function buildDocketAiInput(input: DocketAiInput): string {
  const subject = truncate(input.subject, envInt("DOCKET_AI_MAX_SUBJECT_CHARS", 500));
  const bodySource =
    input.body && input.body.trim() ? input.body : input.bodyPreview;
  const body = truncate(bodySource, envInt("DOCKET_AI_MAX_BODY_CHARS", 6000));
  const ocr = truncate(input.ocrText, envInt("DOCKET_AI_MAX_OCR_CHARS", 4000));

  const parts: string[] = [];
  if (subject) parts.push(`SUBJECT:\n${subject}`);
  if (body) parts.push(`BODY:\n${body}`);
  if (ocr) parts.push(`ATTACHMENT OCR:\n${ocr}`);
  return parts.join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `You verify whether an email thread from GMD's shared quotation/GMD-Clients inbox is a genuine request to create a NEW docket.

A NEW DOCKET means a real customer or party enquiry that needs a fresh docket number and quotation to be created (an RFQ, a tender enquiry, a request for rates/offer, or an explicit "please create docket" request).

Return isNewDocket = true only when the mail clearly represents such a new enquiry.

Return isNewDocket = false when:
- It is a reply, acknowledgement, reminder, or follow-up on an already-existing docket.
- The mail already contains an existing docket number (e.g. GMD/2024-25/123, ENQ-2024-..., "Docket No: ...").
- It is internal/team chatter between GMD or Laser Power Infra mailboxes.
- It is logistics, accounts, payment, dispatch, tender-alert, or ERP mail with no new-docket request.
- It is spam, a newsletter, an auto-notification, or a bounce.
- The mail is forwarded for information only and does not ask to create a docket.
- It is a purchase order (PO / work order / supply order / letter of award) issued BY a customer. A PO is not a request to create a docket.

Pay attention to the SUBJECT, the BODY and any ATTACHMENT OCR. Ignore quoted history. When evidence is mixed or weak, prefer false.

Return only the structured JSON.`;

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
      temperature: 0,
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
