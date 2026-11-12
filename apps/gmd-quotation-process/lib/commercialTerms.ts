// Commercial terms a docket must carry before any item can be validated.
// Blank terms add 0% to cost, so validating without them understates the loading
// and distorts VA%. Pure so the server actions, the UI and the tests share it.

export type CommercialTerms = {
  paymentTerms?: string | null;
  inspection?: string | null;
  pbg?: string | null;
};

export const REQUIRED_VALIDATION_TERMS = [
  { key: "paymentTerms", label: "Payment terms" },
  { key: "inspection", label: "Inspection" },
  { key: "pbg", label: "PBG" },
] as const;

/** "-" is the app's "nothing picked" placeholder, so it counts as blank. "NA" is a real choice. */
export function isBlankTerm(value: string | null | undefined): boolean {
  const s = (value ?? "").trim();
  return s === "" || s === "-";
}

/** Labels of the required terms that are blank, in display order. */
export function missingValidationTerms(terms: CommercialTerms): string[] {
  return REQUIRED_VALIDATION_TERMS.filter((t) => isBlankTerm(terms[t.key])).map((t) => t.label);
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The message shown when Validation = Yes is refused. */
export function validationBlockedMessage(docketNumber: string | null | undefined, missing: string[]): string {
  const where = docketNumber ? `docket ${docketNumber}` : "this docket";
  const verb = missing.length === 1 ? "is" : "are";
  return `Cannot set Validation = Yes: ${joinLabels(missing)} ${verb} blank on ${where}. Fill them first so the correct cost loading is applied.`;
}

export const DEFAULT_TERMS = { paymentTerms: "30 days", inspection: "Our Scope @ 1%", pbg: "NA" };

/** Terms for a party's next enquiry: copied from its latest one, each blank field falling back to the default. */
export function termsForParty(last: CommercialTerms | null | undefined) {
  const pick = (k: keyof typeof DEFAULT_TERMS) => (isBlankTerm(last?.[k]) ? DEFAULT_TERMS[k] : last![k]!);
  return { paymentTerms: pick("paymentTerms"), inspection: pick("inspection"), pbg: pick("pbg") };
}
