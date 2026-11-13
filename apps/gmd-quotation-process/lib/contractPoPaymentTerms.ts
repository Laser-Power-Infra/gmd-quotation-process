// Contract Review payment terms from the PO.
// PO data lives in ContractReview.poNo / orderList, synced from the "CONTRACTS copy"
// sheet by scripts/sync-contract-po.ts. When that sheet carries a payment-terms column
// the sync uses it to fill a blank ContractReview.paymentTerms. Pure for tests.

import { isBlankTerm } from "./commercialTerms";

/** Header names accepted for the PO sheet's payment-terms column (compared normalised). */
export const PO_PAYMENT_TERMS_HEADERS = ["PAYMENT TERMS", "PAYMENT TERM", "PO PAYMENT TERMS"];

/** Same normalisation the PO sync uses for headers: lower-case alphanumerics only. */
export function normalizePoHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index of the payment-terms column in the PO sheet headers, or -1 when the sheet has none. */
export function findPoPaymentTermsColumn(headers: string[]): number {
  const wanted = new Set(PO_PAYMENT_TERMS_HEADERS.map(normalizePoHeader));
  return headers.findIndex((h) => wanted.has(normalizePoHeader(String(h ?? ""))));
}

/** Cleans a sheet cell: trims, squeezes spaces, drops placeholders and formula errors. */
export function cleanPoPaymentTerms(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (isBlankTerm(s) || /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!)$/i.test(s)) return null;
  return s;
}

/**
 * Value to write to ContractReview.paymentTerms, or undefined to leave it.
 * Gap-fill only: a typed (non-blank) value in Contract Review is never overwritten.
 */
export function pickPoPaymentTerms(current: string | null | undefined, fromPo: string | null | undefined): string | undefined {
  const po = cleanPoPaymentTerms(fromPo);
  if (!po) return undefined;
  if (!isBlankTerm(current)) return undefined;
  return po;
}

/**
 * Value to write to ContractReview.poNo, or undefined to leave it.
 * Gap-fill only: a saved PO NO (typed in Contract Review or synced earlier) is never overwritten.
 */
export function pickPoNo(current: string | null | undefined, fromPo: string | null | undefined): string | undefined {
  const po = (fromPo ?? "").trim();
  return po && !(current ?? "").trim() ? po : undefined;
}
