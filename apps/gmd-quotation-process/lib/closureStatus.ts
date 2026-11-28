// Enquiry.closureStatus values, kept free of Prisma so client components can use them too.
// The closure-status sync (lib/closureStatusSync.ts) writes them and re-exports them.

/** The value written to Enquiry.closureStatus; matches the CLOSURE_STATUS lookup. */
export const SENT_CLOSURE_STATUS = "Sent";
export const PENDING_CLOSURE_STATUS = "Pending";
/** Manual "quotation not going out" marker; automation only ever upgrades it to Sent. */
export const NOT_SENT_CLOSURE_STATUS = "Not Sent";
