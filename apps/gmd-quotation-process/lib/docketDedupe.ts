/**
 * Pure planning for the scheduled pending-docket dedupe.
 *
 * The dedupe target is a zero-item docket — the blank subset of the quotation
 * dashboard's auto-created pending set. A duplicate is proven from the source
 * `DocketQuotationThread`, never from a fuzzy guess:
 *
 *   1. the same thread (sourceThreadId / thread.docketNo / attachment URL), or
 *   2. threads whose normalised mail snapshot fingerprint matches (the mail
 *      ingestion can import the same mail under a second Gmail thread id).
 *
 * Only zero-item dockets are ever deleted, and never one carrying work (items,
 * a selected contract, an offer PDF, an approved/sent mail, a duplicate
 * pointer). The keeper is the docket with items, else the one already linked to
 * the thread, else the earliest. Groups that cannot be resolved are reported,
 * not deleted.
 *
 * Kept pure so the rules are unit-testable; the database work lives in
 * `schedular_function/docket-dedupe.ts`.
 */

import { createHash } from "node:crypto";
import { toStringArray } from "./docketSnapshot";

export interface DocketFacts {
  id: string;
  docketNumber: string;
  partyName: string;
  createdAt: Date;
  sourceThreadId: string | null;
  items: number;
  selectedContractNo: string[];
  offerPdfGeneratedAt: Date | null;
  emailApproved: boolean;
  emailSentBy: string | null;
  duplicate: string | null;
  duplicateOfDocket: string | null;
  /** Mail attachment URLs (snapshot PDFs excluded), used to find the thread. */
  attachmentUrls: string[];
}

export interface ThreadFacts {
  threadId: string;
  docketNo: string | null;
  subject: string | null;
  sender: string | null;
  date: Date | null;
  bodyPreview: string | null;
  attachNames: unknown;
  attachLinks: unknown;
}

export type Evidence = "thread" | "snapshot";

export interface DedupeGroup {
  keeper: DocketFacts;
  deletes: DocketFacts[];
  /** Every thread in the group, folded onto the keeper. */
  threadIds: string[];
  evidence: Evidence[];
}

export interface DedupePlan {
  /** Zero-item dockets scanned. */
  pending: number;
  groups: DedupeGroup[];
  skippedWork: { docket: DocketFacts; work: string[] }[];
  skippedAmbiguous: { docket: DocketFacts; reason: string }[];
  unresolved: DocketFacts[];
  /** Planned deletions dropped by the per-run cap; picked up next run. */
  deferred: number;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const rows = map.get(key);
  if (rows) rows.push(value);
  else map.set(key, [value]);
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** `Re:`, `Fwd:` and their repeats are not part of the mail's identity. */
export function normalizeSubject(subject: string | null | undefined): string {
  return clean(subject).replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "").trim();
}

function senderEmail(sender: string | null | undefined): string {
  const match = String(sender ?? "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Identity of the mail behind a thread. Subject, sender and the exact mail
 * timestamp are required; the preview and attachment names complete the hash.
 * A thread missing any of the strong fields gets no fingerprint, so it can only
 * be matched by an exact thread link.
 */
export function snapshotFingerprint(thread: ThreadFacts): string | null {
  const subject = normalizeSubject(thread.subject);
  const from = senderEmail(thread.sender);
  if (!subject || !from || !thread.date) return null;

  const body = clean(thread.bodyPreview);
  const attachments = toStringArray(thread.attachNames)
    .map(clean)
    .filter(Boolean)
    .sort()
    .join("|");
  if (!body && !attachments) return null;

  return createHash("sha256")
    .update([subject, from, thread.date.toISOString(), body, attachments].join("\u0000"))
    .digest("hex");
}

/** Usable (`http`) links on a thread's attachment-link column. */
export function mailUrls(value: unknown): string[] {
  return toStringArray(value)
    .map((url) => url.trim())
    .filter((url) => url.startsWith("http"));
}

export interface ThreadIndex {
  byId: Map<string, ThreadFacts>;
  byDocketNo: Map<string, ThreadFacts[]>;
  byUrl: Map<string, ThreadFacts[]>;
  byFingerprint: Map<string, string[]>;
}

export function buildThreadIndex(threads: ThreadFacts[]): ThreadIndex {
  const byId = new Map<string, ThreadFacts>();
  const byDocketNo = new Map<string, ThreadFacts[]>();
  const byUrl = new Map<string, ThreadFacts[]>();
  const byFingerprint = new Map<string, string[]>();

  for (const thread of threads) {
    byId.set(thread.threadId, thread);
    if (thread.docketNo) push(byDocketNo, thread.docketNo, thread);
    for (const url of mailUrls(thread.attachLinks)) push(byUrl, url, thread);
    const fingerprint = snapshotFingerprint(thread);
    if (fingerprint) {
      const ids = byFingerprint.get(fingerprint);
      if (ids) ids.push(thread.threadId);
      else byFingerprint.set(fingerprint, [thread.threadId]);
    }
  }

  return { byId, byDocketNo, byUrl, byFingerprint };
}

export type ThreadResolution =
  | { ok: true; thread: ThreadFacts; via: "sourceThreadId" | "docketNo" | "attachmentUrl" }
  | { ok: false; ambiguous: boolean; reason: string };

export function resolveDocketThread(
  docket: DocketFacts,
  index: ThreadIndex,
): ThreadResolution {
  if (docket.sourceThreadId) {
    const thread = index.byId.get(docket.sourceThreadId);
    if (thread) return { ok: true, thread, via: "sourceThreadId" };
  }

  const byDocketNo = index.byDocketNo.get(docket.docketNumber) ?? [];
  if (byDocketNo.length === 1) return { ok: true, thread: byDocketNo[0], via: "docketNo" };
  if (byDocketNo.length > 1) {
    return { ok: false, ambiguous: true, reason: "several threads share this docket number" };
  }

  const hits = new Map<string, ThreadFacts>();
  for (const url of docket.attachmentUrls) {
    for (const thread of index.byUrl.get(url) ?? []) hits.set(thread.threadId, thread);
  }
  if (hits.size === 1) {
    return { ok: true, thread: [...hits.values()][0], via: "attachmentUrl" };
  }
  if (hits.size > 1) {
    return { ok: false, ambiguous: true, reason: "mail attachments match several threads" };
  }

  return { ok: false, ambiguous: false, reason: "no source thread found" };
}

/** Work that must not be lost — a zero-item docket carrying it is never deleted. */
export function uniqueWork(docket: DocketFacts): string[] {
  const out: string[] = [];
  if (docket.items > 0) out.push(`items(${docket.items})`);
  if (docket.selectedContractNo.length) {
    out.push(`selectedContract=${docket.selectedContractNo.join(",")}`);
  }
  if (docket.offerPdfGeneratedAt) {
    out.push(`offerPdf=${docket.offerPdfGeneratedAt.toISOString().slice(0, 10)}`);
  }
  if (docket.emailApproved) out.push("emailApproved");
  if (docket.emailSentBy) out.push(`emailSentBy=${docket.emailSentBy}`);
  if (docket.duplicateOfDocket) out.push(`duplicateOf=${docket.duplicateOfDocket}`);
  if (String(docket.duplicate ?? "").trim()) out.push(`duplicate=${docket.duplicate}`);
  return out;
}

function makeUnionFind() {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (current === undefined) {
      parent.set(id, id);
      return id;
    }
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  return { find, union };
}

function evidenceFor(
  members: DocketFacts[],
  resolved: Map<string, ThreadFacts>,
): Evidence[] {
  const threadIds = new Set(
    members
      .map((member) => resolved.get(member.id)?.threadId)
      .filter((id): id is string => !!id),
  );
  return threadIds.size === 1 ? ["thread"] : ["snapshot"];
}

export function planPendingDocketDedupe(
  dockets: DocketFacts[],
  threads: ThreadFacts[],
  maxDeletions = 50,
): DedupePlan {
  const index = buildThreadIndex(threads);
  const unionFind = makeUnionFind();
  const resolved = new Map<string, ThreadFacts>();
  const skippedAmbiguous: { docket: DocketFacts; reason: string }[] = [];
  const unresolved: DocketFacts[] = [];

  for (const docket of dockets) {
    const resolution = resolveDocketThread(docket, index);
    if (resolution.ok) {
      resolved.set(docket.id, resolution.thread);
      unionFind.find(resolution.thread.threadId);
    } else if (docket.items === 0) {
      if (resolution.ambiguous) {
        skippedAmbiguous.push({ docket, reason: resolution.reason });
      } else {
        unresolved.push(docket);
      }
    }
  }

  // The ingestion can import the same mail under a second thread id. Those
  // threads share the snapshot fingerprint, so fold them into one group.
  for (const ids of index.byFingerprint.values()) {
    for (let i = 1; i < ids.length; i++) unionFind.union(ids[0], ids[i]);
  }

  const byRoot = new Map<string, DocketFacts[]>();
  for (const docket of dockets) {
    const thread = resolved.get(docket.id);
    if (!thread) continue;
    push(byRoot, unionFind.find(thread.threadId), docket);
  }

  const threadsByRoot = new Map<string, ThreadFacts[]>();
  for (const thread of threads) {
    push(threadsByRoot, unionFind.find(thread.threadId), thread);
  }

  const groups: DedupeGroup[] = [];
  const skippedWork: { docket: DocketFacts; work: string[] }[] = [];
  const pending = dockets.filter((docket) => docket.items === 0).length;

  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    if (!members.some((member) => member.items === 0)) continue;

    // A manual duplicate flag is the user's call. Folding it automatically could
    // make the flagged docket the keeper, so leave the whole group to the UI /
    // manual CLI.
    const flagged = members.filter(
      (member) => String(member.duplicate ?? "").trim() || member.duplicateOfDocket,
    );
    if (flagged.length) {
      for (const member of flagged) {
        if (member.items === 0) {
          skippedAmbiguous.push({ docket: member, reason: "manual duplicate flag" });
        }
      }
      continue;
    }

    // Keep a docket that already carries work; otherwise the canonical link,
    // otherwise the earliest.
    const protectedMembers = members.filter(
      (member) => member.items > 0 || uniqueWork(member).length > 0,
    );
    const pool = protectedMembers.length ? protectedMembers : members;
    const keeper = [...pool].sort((a, b) => {
      if (b.items !== a.items) return b.items - a.items;
      const linked = (docket: DocketFacts) =>
        (docket.sourceThreadId ||
          resolved.get(docket.id)?.docketNo === docket.docketNumber)
          ? 0
          : 1;
      if (linked(a) !== linked(b)) return linked(a) - linked(b);
      const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
      if (byCreated !== 0) return byCreated;
      return a.docketNumber.localeCompare(b.docketNumber);
    })[0];

    const deletes: DocketFacts[] = [];
    for (const member of members) {
      if (member.id === keeper.id || member.items > 0) continue;
      const work = uniqueWork(member);
      if (work.length) {
        skippedWork.push({ docket: member, work });
        continue;
      }
      deletes.push(member);
    }
    if (deletes.length === 0) continue;
    deletes.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.docketNumber.localeCompare(b.docketNumber),
    );

    const threadIds = new Set<string>();
    const deletedNumbers = new Set(deletes.map((docket) => docket.docketNumber));
    const deletedSources = new Set(
      deletes
        .map((docket) => docket.sourceThreadId)
        .filter((id): id is string => !!id),
    );
    for (const thread of threadsByRoot.get(root) ?? []) {
      const pointsAtGroup =
        thread.docketNo === keeper.docketNumber ||
        (thread.docketNo !== null && deletedNumbers.has(thread.docketNo));
      const isSource =
        thread.threadId === keeper.sourceThreadId || deletedSources.has(thread.threadId);
      // A thread claiming a docket outside this group is left alone: re-pointing
      // it could break a live docket that merely shares the snapshot.
      if (!thread.docketNo || pointsAtGroup || isSource) threadIds.add(thread.threadId);
    }

    groups.push({
      keeper,
      deletes,
      threadIds: [...threadIds],
      evidence: evidenceFor(members, resolved),
    });
  }

  let remaining = Math.max(0, maxDeletions);
  let deferred = 0;
  const capped: DedupeGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) {
      deferred += group.deletes.length;
      continue;
    }
    const keep = group.deletes.slice(0, remaining);
    deferred += group.deletes.length - keep.length;
    remaining -= keep.length;
    if (keep.length > 0) capped.push({ ...group, deletes: keep });
  }

  return { pending, groups: capped, skippedWork, skippedAmbiguous, unresolved, deferred };
}
