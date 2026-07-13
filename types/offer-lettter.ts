export interface OfferLetterItem {
  /** Rendered in the "PARTY ITEM NAME" column. Sourced from dashboard <ITEM NAME>. */
  itemName: string;

  /** Rendered in the "OUR ITEM NAME" column. Sourced from dashboard <PARTY ITEM NAME>. */
  partyItemName: string;

  /** QTY column. Sourced from dashboard <QUANTITY>. */
  quantity: number;

  /** RATE/UNIT column. Sourced from dashboard <QUOTATION RATE>. */
  quotationRate: number;

  /** UNIT column. Always hard-coded to "NO.S". */
  unit: "NO.S";

  /** Delivery Schedule column. Left blank for now. */
  deliverySchedule?: string;
}

export interface OfferLetterTemplateData {
  /** OFFER NO field. Sourced from dashboard <DOCKET NO>. */
  docketNo: string;

  /** State field for naming format and other logic */
  state?: string;

  /** "To" field. Sourced from dashboard <PARTY NAME>. */
  partyName: string;

  /** SUB field. Same as PDF (free text, passed through as-is). */
  subject: string;

  /** Terms & Conditions - Price. Same as PDF. */
  price: string;

  /** Terms & Conditions - Payment Terms. Same as PDF. */
  paymentTerms: string;

  /** Terms & Conditions - Inspection. Same as PDF. */
  inspection: string;

  /** Terms & Conditions - Warranty. Same as PDF. */
  warranty: string;

  /** Terms & Conditions - Approval. Same as PDF. */
  approval: string;

  /** Terms & Conditions - Delivery Destination. Same as PDF. */
  deliveryDestination: string;

  /** Base64 data URL of the company logo */
  logoDataUrl?: string;

  /** Annexure-A price table rows. SL NO is derived automatically (index + 1). */
  items: OfferLetterItem[];
}

export type IncHelper = (index: number) => number;