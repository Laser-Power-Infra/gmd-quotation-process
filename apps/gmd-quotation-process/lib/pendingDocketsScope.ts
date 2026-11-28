import { prisma } from "@/lib/prisma";
import {
  buildPartyMatcher,
  buildPartySearchText,
  hasDocketCreationKeyword,
  isGenuineGmdClientThread,
  isPendingDocketCandidate,
  isPurchaseOrderMail,
  hasRealDocketNo,
  NO_REAL_DOCKET_WHERE,
} from "@/lib/docketPending";
import {
  enqueueDocketAiValidation,
  getDocketAiMaxAttempts,
  isDocketAiEligible,
  type DocketAiThreadInput,
} from "@/lib/docketAiValidationRunner";
import { isDocketAiValidationEnabled } from "@/lib/docketAiValidator";
import { detectDocketNumber } from "@/schedular_function/docket-followup-sync";
import { getPendingDocketsCache, setPendingDocketsCache } from "@/lib/pendingDocketsCache";
import type { PendingScope } from "@gmd/pending-dockets/columns";

/**
 * Which threads the Pending Dockets tab shows, and where each one's AI check stands. The rules moved
 * here unchanged from the old /api/docket-follow-up/pending-dockets route; @gmd/pending-dockets then
 * pages, filters, sorts and counts this set in SQL.
 *
 * Side effects, as before: shown threads are flagged `pendingDocket = true`, a matched party name is
 * stored, and the one-by-one AI queue is kicked. Cached briefly, so paging and facets reuse it.
 */
export async function getPendingDocketsScope(): Promise<PendingScope> {
  const aiEnabled = isDocketAiValidationEnabled();
  const aiMaxAttempts = getDocketAiMaxAttempts();
  const rawPerRequest = Number(process.env.DOCKET_AI_MAX_PER_REQUEST);
  const perRequestLimit = Number.isFinite(rawPerRequest) && rawPerRequest > 0 ? Math.floor(rawPerRequest) : 25;

  // Fast path: reuse the last computed set, but still kick the background queue so newly eligible
  // rows keep progressing.
  const cached = getPendingDocketsCache();
  if (cached) {
    if (aiEnabled) enqueueDocketAiValidation(cached.candidates, perRequestLimit);
    return cached.scope;
  }

  // Narrow query: only the precomputed pending/attempted/verified set, never the whole 10k thread table.
  const threads = await prisma.docketQuotationThread.findMany({
    where: {
      duplicateOfDocket: null,
      // GeM / e-proc tender refs in docket_no are not dockets (see isTenderRefNotDocket), so those
      // mails can still be pending.
      AND: [NO_REAL_DOCKET_WHERE, { OR: [{ pendingDocket: true }, { aiIsNewDocket: true }, { aiValidationAttempts: { gt: 0 } }] }],
    },
    orderBy: { date: "desc" },
    take: 10000,
    select: {
      id: true,
      docketNo: true,
      subject: true,
      toDetails: true,
      ccDetails: true,
      body: true,
      bodyPreview: true,
      attachNames: true,
      isGmdClient: true,
      userLabels: true,
      company: true,
      ocrText: true,
      pendingDocket: true,
      aiIsNewDocket: true,
      aiValidationAttempts: true,
      duplicateOfDocket: true,
      partyName: true,
    },
  });

  const partyRows = await prisma.lookupOption.findMany({
    where: { type: "PARTY", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { value: true },
  });
  const matchPartyName = buildPartyMatcher(partyRows.map((r) => r.value));
  const pendingDocketWriteIds: number[] = [];
  const partyNameWrites: { id: number; partyName: string }[] = [];
  const candidates: DocketAiThreadInput[] = [];
  const rows: PendingScope["rows"] = [];

  for (const t of threads) {
    const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
    const hasCreationKeyword = hasDocketCreationKeyword(text);

    // AI-rejected rows are hidden, except when the thread explicitly asks "please create docket": the
    // AI was rejecting those as internal forwards / reminders (e.g. Puja's "Please create docket - LCC
    // ..."), so they vanished from this tab. Such rows show as unverified and must still pass the
    // candidate rule below.
    const aiVerdict = t.aiIsNewDocket === false && hasCreationKeyword ? null : t.aiIsNewDocket ?? null;
    if (aiVerdict === false) continue;
    // Customer POs are not docket requests; hides rows flagged earlier.
    if (isPurchaseOrderMail(t) && !hasCreationKeyword) continue;

    // Verified true rows remain visible even if the candidate rules change later. Undecided rows must
    // still pass the current rule: genuine GMD client AND forwarded to Laser Entry AND docket context.
    if (aiVerdict !== true) {
      if (!isGenuineGmdClientThread(t)) continue;
      const isCandidate = isPendingDocketCandidate({
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
        text,
      });
      if (!isCandidate) continue;
    }

    // The "_" pre-filter over-selects; a real docket still hides the row, as does a GMD docket already
    // quoted in the mail while docket_no holds only the tender ref.
    if (hasRealDocketNo(t.docketNo)) continue;
    if (t.docketNo && detectDocketNumber({ ...t, docketNo: null })) continue;

    const aiInput: DocketAiThreadInput = {
      id: t.id,
      subject: t.subject,
      body: t.body,
      bodyPreview: t.bodyPreview,
      ocrText: t.ocrText,
      docketNo: null, // tender ref, not a docket
      duplicateOfDocket: t.duplicateOfDocket,
      aiIsNewDocket: t.aiIsNewDocket,
      aiValidationAttempts: t.aiValidationAttempts ?? 0,
      userLabels: t.userLabels,
      isGmdClient: t.isGmdClient,
      company: t.company,
      toDetails: t.toDetails,
      ccDetails: t.ccDetails,
    };
    // Only rows the queue will really send to the model show "Verifying…".
    const aiQueued = aiEnabled && isDocketAiEligible(aiInput);
    if (aiQueued) candidates.push(aiInput);

    if (t.pendingDocket !== true) pendingDocketWriteIds.push(t.id);
    const matchedParty = matchPartyName(buildPartySearchText(t));
    if (matchedParty && !t.partyName) partyNameWrites.push({ id: t.id, partyName: matchedParty });

    // An explicit "please create docket" mail is a docket request by definition (AI rule 2), so it is
    // verified without spending a model call. Otherwise "Verifying…" only while a model call is really
    // coming; else final "Not verified" (attempts used up, AI off, or ineligible).
    const verified = aiVerdict === true || hasCreationKeyword;
    rows.push({ id: t.id, ai: verified ? "Verified" : aiQueued ? "Verifying" : "Not verified" });
  }

  // Persist enrichment only; never block the response on AI.
  try {
    for (let i = 0; i < pendingDocketWriteIds.length; i += 500) {
      await prisma.docketQuotationThread.updateMany({
        where: { id: { in: pendingDocketWriteIds.slice(i, i + 500) } },
        data: { pendingDocket: true },
      });
    }
    for (const row of partyNameWrites) {
      await prisma.docketQuotationThread.update({ where: { id: row.id }, data: { partyName: row.partyName } });
    }
  } catch (err) {
    console.warn("Pending dockets: enrichment write-back failed:", err);
  }

  const scope: PendingScope = { rows, aiEnabled, aiMaxAttempts };
  setPendingDocketsCache(scope, candidates);
  // Background, one-by-one, candidate-only. Never awaited.
  if (aiEnabled) enqueueDocketAiValidation(candidates, perRequestLimit);
  return scope;
}
