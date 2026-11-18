import type { PendingAttachment } from "../columns";

// Mail-thread text as the import stores it: "--- Message N From: Name <email> ---" blocks.
// Moved unchanged from the old /api/docket-follow-up/pending-dockets route.

export interface ParsedMessage {
  num: number;
  senderName: string;
  senderEmail: string | null;
  fullSender: string;
  body: string;
}

export function parseThreadMessages(bodyText: string | null | undefined): ParsedMessage[] {
  if (!bodyText) return [];
  const pattern = /---\s*Message\s*(\d+)\s*From:\s*([^\n\r-]+?)(?:\s*<([^>]+)>)?\s*---/gi;
  const matches = Array.from(bodyText.matchAll(pattern));
  if (matches.length === 0) {
    return [{ num: 1, senderName: "", senderEmail: null, fullSender: "", body: bodyText.trim() }];
  }

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const num = parseInt(match[1], 10);
    const senderName = (match[2] || "").trim();
    let senderEmail = match[3] ? match[3].trim() : null;
    const startPos = match.index + match[0].length;
    const endPos = i + 1 < matches.length ? matches[i + 1].index : bodyText.length;
    const rawBody = bodyText.slice(startPos, endPos).trim();

    if (!senderEmail) {
      const fromHeaderMatch = rawBody.match(/From:\s*[^<\n\r]*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/i);
      if (fromHeaderMatch) {
        senderEmail = fromHeaderMatch[1].trim();
      } else {
        const anyEmailMatch = rawBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyEmailMatch) senderEmail = anyEmailMatch[0].trim();
      }
    }

    // The reply ends where the quoted / forwarded history starts.
    const cleanLines: string[] = [];
    for (const line of rawBody.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith(">") ||
        trimmed.startsWith("---------- Forwarded") ||
        (trimmed.startsWith("On ") && (trimmed.includes("wrote:") || trimmed.includes("@") || /at\s+\d{1,2}:\d{2}/i.test(trimmed))) ||
        /^From:\s*/i.test(trimmed)
      ) {
        break;
      }
      cleanLines.push(line);
    }
    const cleanBody = cleanLines.join("\n").trim();

    messages.push({
      num,
      senderName,
      senderEmail,
      fullSender: senderEmail ? `${senderName} <${senderEmail}>` : senderName,
      body: cleanBody || rawBody,
    });
  }
  return messages;
}

/** The request as the table shows it: the first message, else the preview; 400 characters. */
export function requestSnippet(body: string | null, bodyPreview: string | null): string {
  const first = parseThreadMessages(body || bodyPreview || "")[0];
  return (first?.body || bodyPreview || "").slice(0, 400).trim();
}

const LASER_ENTRY = "laserentry.four@gmail.com";

/** Laser Entry answered on the thread: as the sender, in a message block, or in a quoted From: line. */
export function repliedByLaserEntry(sender: string | null, bodyText: string, messages: ParsedMessage[]): boolean {
  if ((sender || "").toLowerCase().includes(LASER_ENTRY)) return true;
  if (messages.some((m) => `${m.senderName} ${m.senderEmail || ""}`.toLowerCase().includes("laserentry"))) return true;
  return /From:\s*[^<\n\r]*<?([a-zA-Z0-9._%+-]*laserentry[a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+)>?/i.test(bodyText);
}

/** Files of the mail with their links (index-aligned); placeholders like "[No Attachments]" are dropped. */
export function attachmentsOf(names: unknown, links: unknown): PendingAttachment[] {
  if (!Array.isArray(names)) return [];
  const rawLinks: unknown[] = Array.isArray(links) ? links : [];
  const out: PendingAttachment[] = [];
  names.forEach((n, i) => {
    const name = typeof n === "string" ? n.trim() : "";
    if (!name || name.startsWith("[")) return;
    const link = rawLinks[i] ? String(rawLinks[i]).trim() : "";
    out.push({ name, link: link && link !== "[No Links]" ? link : null });
  });
  return out;
}
