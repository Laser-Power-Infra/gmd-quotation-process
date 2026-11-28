/**
 * Contact person, phone and utility for a docket, read from its enquiry mail.
 * Pure (no DB): docket creation and scripts/backfill-docket-contact.ts load the
 * rows and call these; the opt-in AI fallback for what is still blank lives in
 * lib/docketContactAi.ts.
 */

import {
  lookupUtilityResolver,
  normalizeUtility,
  parseUtilityMapping,
  parseUtilityMaster,
  UTILITY_MAPPING_CSV,
  UTILITY_MASTER_CSV,
} from "@gmd/contract-review/utility-master";
import { isInternalEmail, rootSenderEmails } from "./enquiryEmailParty";

export interface MailContact {
  contactPerson: string | null;
  phone: string | null;
}

const NONE: MailContact = { contactPerson: null, phone: null };

/** The thread's first message, header line included: the "Message 1" block of `body`, else `bodyPreview`. */
export function firstMessage(thread: { body?: string | null; bodyPreview?: string | null }): string {
  return (thread.body || thread.bodyPreview || "").split(/\n(?=---\s*Message\s*\d+\s*From:)/i)[0];
}

// "Thanks & Regards," / "Warm regards" / "Yours faithfully"; a name may follow on the same line after punctuation.
const SIGN_OFF =
  /^(?:(?:(?:thanks?|thank\s+you|thanking\s+you)\s*(?:&|and|n|with)\s*)?(?:with\s+)?(?:(?:best|warm|kind|warmest|kindest)\s+)?(?:regards|regds|rgds)|br|yours\s+(?:faithfully|sincerely|truly)|sincerely|thanking\s+you|thanks|thank\s+you)\b(?:\s*[,.!:;-]+\s*(.*)|\s*)$/i;
// Where the author's own text ends: a quoted mail, a forward or a reply header.
const QUOTE_START = /^(?:from:|>|-{5,}|on\s.*wrote:?$)/i;
const SIGNATURE_LINES = 10;
const NAME_LINES = 3;

const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|er|shri|smt|prof)\b\.?\s*/i;
// A word that makes a signature line a designation, company, address or label rather than a person's name.
const NOT_NAME =
  /\b(?:for|regards|thanks?|thanking|yours|faithfully|sincerely|dear|sir|madam|team|please|kindly|sent|from|iphone|android|mobile|mob|phone|ph|tel|fax|e-?mail|web|website|www|contact|limited|ltd|pvt|private|llp|inc|corp|corporation|company|co|industries|enterprises?|constructions?|infra|infrastructure|engineering|engineers?|builders|developers|group|projects?|solutions|services|systems|technologies|traders|trading|associates|contractors?|department|dept|division|section|procurement|purchase|purchasing|sales|marketing|proposals?|tenders?|tendering|commercial|technical|operations|accounts?|finance|admin|stores?|materials?|contracts?|planning|design|quality|manager|mgr|executive|officer|director|head|hod|assistant|asst|senior|sr|junior|jr|deputy|dy|general|agm|dgm|gm|ceo|president|vp|chairman|partner|proprietor|supply|chain|scm|management|coordinator|consultant|incharge|designation|employee|house|tower|towers|plot|road|floor|street|complex|building|block|sector|lane|marg|colony|near|opp|estate|office|branch|plant|site|works|factory)\b/i;

const clean = (line: string) => line.replace(/[*_\u200B-\u200D\uFEFF]/g, "").trim();

/** The line as a person's name ("Mr. P. Varma Raju," -> "P. Varma Raju"), or null when it is not one. */
export function personName(line: string | null | undefined): string | null {
  const name = String(line ?? "")
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(HONORIFIC, "")
    .replace(/[\s,.;:-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^[A-Za-z][A-Za-z.' -]*$/.test(name) || name.split(" ").length > 5) return null;
  if (name.replace(/[^A-Za-z]/g, "").length < 3 || NOT_NAME.test(name)) return null;
  return name;
}

// One phone-looking run; matched per line so a PIN code never joins the next line's number.
const PHONE_RUN = /\+?\(?\+?\d[\d ().-]{7,}\d/g;

function phoneOf(run: string): { phone: string; mobile: boolean } | null {
  const digits = run.replace(/\D/g, "");
  const national =
    digits.length === 12 && digits.startsWith("91") ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0") ? digits.slice(1)
    : digits.length === 13 && digits.startsWith("910") ? digits.slice(3)
    : digits.length === 10 ? digits
    : null;
  if (!national) return null;
  // A 2-4 digit STD group first ("+91 79 4007 4303", "080 22492911") is a landline even when it starts 6-8.
  // shortcut: an ungrouped landline ("08022492911") reads as a mobile; use the line's T:/Ph: vs M:/Mob: label if that matters.
  const firstGroup = run.replace(/^\D*(?:91\D+|0)?/, "").match(/^\d+/)?.[0].length ?? 0;
  const stdGrouped = firstGroup >= 2 && firstGroup <= 4 && !national.startsWith("9");
  if (/^[6-9]/.test(national) && !stdGrouped) {
    return { phone: `+91 ${national.slice(0, 5)} ${national.slice(5)}`, mobile: true };
  }
  // A landline needs its 0 / +91 prefix: a bare 10-digit run starting 1-5 is more likely a reference number.
  return national !== digits ? { phone: run.trim(), mobile: false } : null;
}

/** First Indian mobile in the lines ("+91 98300 12345"), else the first landline as written; fax lines skipped. */
export function phoneIn(lines: string[]): string | null {
  const found = lines
    .filter((l) => !/\bfax\b/i.test(l))
    .flatMap((l) => (l.match(PHONE_RUN) ?? []).map(phoneOf))
    .filter((p) => p !== null);
  return (found.find((p) => p.mobile) ?? found[0])?.phone ?? null;
}

/**
 * Contact person and phone from the signature of the enquiry's first message:
 * the lines after the sign-off ("Thanks & Regards", ...) up to any quoted mail.
 * Nothing is taken from outside that block; null when unsure. When the first
 * message is our own forward, only the forwarded original from `senderEmail`
 * (the docket's sender) is read.
 */
export function contactFromMail({
  firstMessage,
  senderEmail,
}: {
  firstMessage: string;
  senderEmail?: string | null;
}): MailContact {
  let lines = firstMessage.split(/\r?\n/).map(clean);
  if (rootSenderEmails(firstMessage).some(isInternalEmail)) {
    const sender = senderEmail?.trim().toLowerCase();
    const from = sender ? lines.findIndex((l) => /^from:/i.test(l) && l.toLowerCase().includes(sender)) : -1;
    if (from < 0) return NONE;
    lines = lines.slice(from + 1);
  }
  const quote = lines.findIndex((l) => QUOTE_START.test(l));
  const own = quote < 0 ? lines : lines.slice(0, quote);
  const at = own.findIndex((l) => SIGN_OFF.test(l));
  if (at < 0) return NONE;
  const block = [SIGN_OFF.exec(own[at])?.[1] ?? "", ...own.slice(at + 1)].filter(Boolean).slice(0, SIGNATURE_LINES);
  return {
    contactPerson: block.slice(0, NAME_LINES).map(personName).find((n) => n !== null) ?? null,
    phone: phoneIn(block),
  };
}

export interface UtilityEntry {
  /** A name the utility is known by: LookupOption value, master full name or mapping alias. */
  name: string;
  /** The active UTILITY LookupOption value it resolves to. */
  utility: string;
}

/** Every known name of the active utilities, resolved through the shared utility-master resolver. */
export function utilityEntries(rows: { value: string; code: string | null }[]): UtilityEntry[] {
  const resolve = lookupUtilityResolver(rows);
  const names = [
    ...rows.map((r) => r.value),
    ...parseUtilityMaster(UTILITY_MASTER_CSV).map((m) => m.name),
    ...parseUtilityMapping(UTILITY_MAPPING_CSV).map((m) => m.oldValue),
  ];
  return names.flatMap((name) => {
    const r = resolve(name);
    return r.kind === "map" ? [{ name, utility: r.utility }] : [];
  });
}

// Case, spacing, "&"/"and" and punctuation-insensitive, padded so a word match is a substring match.
const words = (v: string) => ` ${normalizeUtility(v).replace(/[^a-z0-9]+/g, " ").trim()} `;

/** The LookupOption value of the one utility the text names, else null (none, or two different ones). */
export function utilityFromText(text: string, entries: UtilityEntry[]): string | null {
  const haystack = words(text);
  const hits = new Set(
    entries
      // shortcut: names under 4 chars ("IR", "DJB") are skipped like buildPartyMatcher; 4-letter ones ("FACT") can still hit plain words.
      .filter((e) => words(e.name).trim().length >= 4 && haystack.includes(words(e.name)))
      // "Private Limited" is in most signatures: the non-utility marker is never read from text.
      .filter((e) => !/^private\b/i.test(e.utility))
      .map((e) => e.utility),
  );
  return hits.size === 1 ? [...hits][0] : null;
}
