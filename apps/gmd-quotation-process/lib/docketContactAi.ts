/**
 * Opt-in AI fallback for the docket phone and utility the mail rules
 * (lib/docketContact.ts) left blank. The contact person is never asked for: from
 * a company-only signature the AI took "H C JAIN ENGINEERING PVT LTD" for a
 * person. Same gate and structured-output pattern as the item extraction: off
 * unless AI_FALLBACK_ENABLED=true and OPENAI_API_KEY is set. Never throws, so it
 * can never block docket creation.
 */

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { normalizeUtility } from "@gmd/contract-review/utility-master";
import { aiFallbackEnabled } from "@/schedular_function/docket-item-extraction";
import { phoneIn, type UtilityEntry } from "./docketContact";

export interface DocketContact {
  contactPerson: string | null;
  phone: string | null;
  utility: string | null;
}

const MAX_MESSAGE_CHARS = 6_000;
const MAX_OCR_CHARS = 3_000;

const schema = z.object({
  phone: z.string().nullable().describe("Phone number of the customer who sent the enquiry, exactly as written; null if not stated."),
  utility: z.string().nullable().describe("The utility, copied exactly from the list; null if the mail does not make it clear."),
});

/** Merges an AI answer into the blanks of `current`: phone re-parsed, utility only when it names a known utility; never the contact person. */
export function applyAiContact(
  current: DocketContact,
  answer: { phone?: string | null; utility?: string | null } | undefined,
  utilities: UtilityEntry[],
): DocketContact {
  const named = answer?.utility ? normalizeUtility(answer.utility) : null;
  return {
    ...current,
    phone: current.phone ?? (answer?.phone ? phoneIn([answer.phone]) : null),
    utility: current.utility ?? (utilities.find((u) => normalizeUtility(u.name) === named)?.utility ?? null),
  };
}

/** Fills only a blank phone / utility of `current`; returns it unchanged when AI is off, both are set, or the call fails. */
export async function fillContactWithAi(
  mail: { subject?: string | null; firstMessage: string; ocrText?: string | null },
  current: DocketContact,
  utilities: UtilityEntry[],
): Promise<DocketContact> {
  if (!aiFallbackEnabled() || (current.phone && current.utility)) return current;
  const values = [...new Set(utilities.map((u) => u.utility))].sort();
  try {
    const result = await generateText({
      model: openai(process.env.AI_EXTRACTION_MODEL || "gpt-4o-mini"),
      output: Output.object({ schema }),
      system: `You read a valve enquiry email sent to G.M. Dalui & Sons / Laser Power & Infra (GMD).
Return the phone number of the customer who sent it (from their signature) and the utility: the government body or owner the project is for (not the contractor), chosen only from this list: ${values.join("; ")}.
Never return a G.M. Dalui, GMD or Laser Power number. Use null for anything the mail does not state. Do not guess.`,
      prompt: [
        mail.subject ? `SUBJECT: ${mail.subject}` : "",
        `FIRST MESSAGE:\n${mail.firstMessage.slice(0, MAX_MESSAGE_CHARS)}`,
        mail.ocrText ? `ATTACHMENT TEXT:\n${mail.ocrText.slice(0, MAX_OCR_CHARS)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      temperature: 0,
    });
    return applyAiContact(current, result.output, utilities);
  } catch (e) {
    console.warn("[docket-contact] AI fallback failed:", e instanceof Error ? e.message : e);
    return current;
  }
}
