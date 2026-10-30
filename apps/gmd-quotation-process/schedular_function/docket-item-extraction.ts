/**
 * Item extraction orchestrator for the `docket-creation` job.
 *
 * Strategy: the deterministic parser (`docket-item-parser.ts`) runs first over
 * the subject, every message body, the attachment OCR text and the attachment
 * text. Only when it finds **nothing** does an opt-in AI fallback run.
 *
 * The fallback is off unless `AI_FALLBACK_ENABLED=true` and `OPENAI_API_KEY` is
 * set; it uses the repo's standard structured-output pattern (strict zod schema,
 * `temperature: 0`) and drops any item without a stated quantity, matching the
 * parser's contract.
 */

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { parseDocketItems, type ParsedDocketItem } from "./docket-item-parser";
import { collectAttachmentTexts } from "./docket-attachments";

export interface DocketItemExtractionInput {
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  ocrText?: string | null;
  attachNames?: unknown;
  attachLinks?: unknown;
}

export interface DocketItemExtractionResult {
  items: ParsedDocketItem[];
  source: "parser" | "ai" | "none";
  /** Items the deterministic parser found before any fallback. */
  parserItems: number;
  aiUsed: boolean;
  /** True when the AI reviewed the parser's items. */
  aiValidated: boolean;
  /** Parser items the AI dropped as junk. */
  aiDropped: number;
  attachmentFailures: number;
  attachmentSkipped: number;
}

const MAX_AI_INPUT_CHARS = 40_000;

const aiItemSchema = z.object({
  items: z
    .array(
      z.object({
        itemName: z.string().describe("The item description exactly as written in the mail; do not expand abbreviations."),
        quantity: z.coerce.number().describe("The numeric quantity stated for this item."),
      }),
    )
    .describe("Only the line items explicitly requested with an explicit quantity. Exclude headers, totals, rates, signatures and quoted history."),
});

const aiValidationSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().describe("Index of the candidate item, as numbered in the prompt."),
      keep: z.boolean().describe("false if the row is not a real requested line item (header, spec, price, serial no., quoted history)."),
      quantity: z.number().optional().describe("Corrected quantity, only if the candidate quantity is wrong per the mail."),
    }),
  ),
});

function aiFallbackEnabled(): boolean {
  const flag = (process.env.AI_FALLBACK_ENABLED ?? "").trim().toLowerCase();
  return (flag === "true" || flag === "1") && !!process.env.OPENAI_API_KEY;
}

function buildAiInput(input: DocketItemExtractionInput, attachmentTexts: string[]): string {
  const parts: string[] = [];
  if (input.subject) parts.push(`SUBJECT: ${input.subject}`);
  if (input.bodyPreview) parts.push(`FIRST MESSAGE:\n${input.bodyPreview}`);
  if (input.body) parts.push(`THREAD:\n${input.body}`);
  if (input.ocrText) parts.push(`ATTACHMENT OCR:\n${input.ocrText}`);
  for (const text of attachmentTexts) parts.push(`ATTACHMENT TEXT:\n${text}`);
  const joined = parts.join("\n\n---\n\n");
  return joined.length > MAX_AI_INPUT_CHARS ? joined.slice(0, MAX_AI_INPUT_CHARS) : joined;
}

async function aiExtract(text: string): Promise<ParsedDocketItem[]> {
  if (!text.trim()) return [];

  const result = await generateText({
    model: openai(process.env.AI_EXTRACTION_MODEL || "gpt-6-luna"),
    output: Output.object({ schema: aiItemSchema }),
    system: `You extract line items from industrial quotation enquiry emails (valves, pipes, fittings) for GMD.

GOAL: return every line item the customer explicitly requested, with its quantity.

RULES:
- Return itemName EXACTLY as written. Do NOT expand abbreviations, add size/type/material, or rephrase.
- Only include an item when an explicit quantity is stated ("2 Nos", "Qty: 5", "3 sets"). Drop items with no quantity.
- Exclude table headers, column titles, totals/subtotals, rates, prices, GST/HSN, delivery/payment terms, signatures, disclaimers and quoted reply history.
- Do not invent items. If nothing qualifies, return an empty list.
- Return only the requested JSON.`,
    prompt: text,
    temperature: 0,
  });

  const raw = result.output?.items ?? [];
  return raw
    .map((i) => ({ itemName: String(i.itemName ?? "").trim(), quantity: Number(i.quantity) }))
    .filter((i) => i.itemName.length >= 2 && Number.isFinite(i.quantity) && i.quantity > 0 && i.quantity <= 1_000_000)
    .slice(0, 500);
}

/** Applies AI verdicts: drop or re-quantify only; bad indices and all-drop answers are ignored. */
export function applyVerdicts(
  items: ParsedDocketItem[],
  rawVerdicts: { index: number; keep: boolean; quantity?: number }[],
): { items: ParsedDocketItem[]; dropped: number } {
  const verdicts = new Map<number, { keep: boolean; quantity?: number }>();
  for (const v of rawVerdicts) {
    if (Number.isInteger(v.index) && v.index >= 0 && v.index < items.length) verdicts.set(v.index, v);
  }
  const kept: ParsedDocketItem[] = [];
  items.forEach((item, n) => {
    const v = verdicts.get(n);
    if (v && !v.keep) return;
    const q = v?.quantity;
    kept.push(q !== undefined && Number.isFinite(q) && q > 0 && q <= 1_000_000 ? { ...item, quantity: q } : item);
  });
  // An all-drop answer is more likely a bad AI reply than an all-junk parse.
  if (kept.length === 0) return { items, dropped: 0 };
  return { items: kept, dropped: items.length - kept.length };
}

/**
 * Asks the AI to review parser items against the mail. It may only drop a row or
 * correct a quantity; names are never taken from the AI, so nothing is invented.
 * Throws on AI failure (caller keeps the parser items).
 */
async function aiValidate(
  text: string,
  items: ParsedDocketItem[],
): Promise<{ items: ParsedDocketItem[]; dropped: number }> {
  const candidates = items.map((i, n) => `${n}. ${i.itemName} | qty ${i.quantity}`).join("\n");
  const result = await generateText({
    model: openai(process.env.AI_EXTRACTION_MODEL || "gpt-4o-mini"),
    output: Output.object({ schema: aiValidationSchema }),
    system: `You review line items that a regex parser extracted from an industrial quotation enquiry email (valves, pipes, fittings).
For each numbered candidate return keep=false if it is not a real requested item with a quantity (table header, spec, pressure, serial number, price, total, quoted history). If the quantity is wrong according to the mail, return the corrected quantity. Do not add items and do not rename anything. Return one verdict per candidate.`,
    prompt: `${text}

=== CANDIDATES ===
${candidates}`,
    temperature: 0,
  });

  return applyVerdicts(items, result.output?.verdicts ?? []);
}

const CONDENSE_CHUNK = 40;
const MAX_NAME_CHARS = 250;

const aiCondenseSchema = z.object({
  names: z.array(
    z.object({
      index: z.number().int().describe("Index of the candidate item, as numbered in the prompt."),
      itemName: z.string().describe("Short, compact item name built only from facts in the candidate."),
    }),
  ),
});

/** Swaps in condensed names; bad indices and empty / longer-than-original names are ignored. */
export function applyCondensed(
  items: ParsedDocketItem[],
  raw: { index: number; itemName: string }[],
): ParsedDocketItem[] {
  const names = new Map<number, string>();
  for (const r of raw) {
    const name = String(r.itemName ?? "").replace(/\s+/g, " ").trim();
    if (Number.isInteger(r.index) && r.index >= 0 && r.index < items.length && name.length >= 2) {
      names.set(r.index, name.slice(0, MAX_NAME_CHARS));
    }
  }
  const seen = new Set<string>();
  const out: ParsedDocketItem[] = [];
  items.forEach((item, n) => {
    const name = names.get(n);
    const next = name && name.length <= item.itemName.length ? { ...item, itemName: name } : item;
    const key = `${next.itemName.toLowerCase()}|${next.quantity}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(next);
  });
  return out;
}

/** Rewrites long BOQ descriptions into compact names. Throws on AI failure (caller keeps originals). */
async function aiCondense(items: ParsedDocketItem[]): Promise<ParsedDocketItem[]> {
  const names: { index: number; itemName: string }[] = [];
  for (let start = 0; start < items.length; start += CONDENSE_CHUNK) {
    const chunk = items.slice(start, start + CONDENSE_CHUNK);
    const result = await generateText({
      model: openai(process.env.AI_EXTRACTION_MODEL || "gpt-4o-mini"),
      output: Output.object({ schema: aiCondenseSchema }),
      system: `You shorten industrial item descriptions (valves, pipes, fittings) from quotation enquiries into compact item names.
Build each name ONLY from facts stated in the candidate: item type, body/disc material of construction, seat/type, operation (tamper proof, gear operated, etc.), applicable standards (IS / AWWA / BS), PN or pressure rating, end connection and size (mm / DN).
Drop contractual boilerplate: providing / fixing / jointing, rate inclusions, taxes, freight, testing certificates, painting, encasing, supports, accessories.
Never invent or change values. If a candidate is already short and clear, return it unchanged. Return one name per candidate, max ${MAX_NAME_CHARS} characters.`,
      prompt: chunk.map((i, n) => `${n}. ${i.itemName}`).join("\n"),
      temperature: 0,
    });
    for (const r of result.output?.names ?? []) names.push({ index: r.index + start, itemName: r.itemName });
  }
  return applyCondensed(items, names);
}

/** Condenses names when AI is enabled; any failure keeps the original names. */
async function condenseNames(items: ParsedDocketItem[]): Promise<ParsedDocketItem[]> {
  if (!aiFallbackEnabled() || items.length === 0) return items;
  try {
    return await aiCondense(items);
  } catch (e) {
    console.warn("[docket-item-extraction] AI condense failed:", e instanceof Error ? e.message : e);
    return items;
  }
}

/**
 * Extracts `{ itemName, quantity }` candidates for one thread.
 *
 * Never throws: attachment, parser and AI errors are all swallowed. A parse
 * failure yields an empty result; an AI failure keeps the parser items.
 */
export async function extractDocketItems(
  input: DocketItemExtractionInput,
): Promise<DocketItemExtractionResult> {
  const bodies = [input.body, input.bodyPreview].filter((b): b is string => !!b);
  let attachments: Awaited<ReturnType<typeof collectAttachmentTexts>> = { texts: [], failures: 0, skipped: 0 };
  let parserItems: ParsedDocketItem[] = [];
  try {
    attachments = await collectAttachmentTexts(input.attachNames, input.attachLinks);
    parserItems = parseDocketItems({
      bodies,
      ocrText: input.ocrText,
      attachmentTexts: attachments.texts,
    });
  } catch (e) {
    console.warn("[docket-item-extraction] parse failed:", e instanceof Error ? e.message : e);
  }

  if (parserItems.length > 0) {
    let items = parserItems;
    let aiValidated = false;
    let aiDropped = 0;
    if (aiFallbackEnabled()) {
      try {
        const v = await aiValidate(buildAiInput(input, attachments.texts), parserItems);
        items = v.items;
        aiDropped = v.dropped;
        aiValidated = true;
      } catch (e) {
        console.warn("[docket-item-extraction] AI validation failed:", e instanceof Error ? e.message : e);
      }
    }
    return {
      items: await condenseNames(items),
      source: "parser",
      parserItems: parserItems.length,
      aiUsed: false,
      aiValidated,
      aiDropped,
      attachmentFailures: attachments.failures,
      attachmentSkipped: attachments.skipped,
    };
  }

  if (aiFallbackEnabled()) {
    try {
      const aiItems = await aiExtract(buildAiInput(input, attachments.texts));
      if (aiItems.length > 0) {
        return {
          items: await condenseNames(aiItems),
          source: "ai",
          parserItems: 0,
          aiUsed: true,
          aiValidated: false,
          aiDropped: 0,
          attachmentFailures: attachments.failures,
          attachmentSkipped: attachments.skipped,
        };
      }
    } catch (e) {
      console.warn("[docket-item-extraction] AI fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    items: [],
    source: "none",
    parserItems: 0,
    aiUsed: false,
    aiValidated: false,
    aiDropped: 0,
    attachmentFailures: attachments.failures,
    attachmentSkipped: attachments.skipped,
  };
}
