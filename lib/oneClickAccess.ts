/**
 * oneClickAccess — decision helper for Offer PDF button.
 * Rules:
 * - apm === "No"  → never allowed
 * - apm === "Yes" && already generated → frozen (allowed once)
 * - otherwise (null/undefined or Yes first time) → allowed
 */
export function oneClickAccess(
  apm: string | null | undefined,
  offerPdfGeneratedAt: Date | string | null | undefined
): { allowed: boolean; reason?: string } {
  if (apm === "No") {
    return { allowed: false, reason: "Offer PDF disabled — APM is No" }
  }
  if (apm === "Yes" && offerPdfGeneratedAt) {
    return { allowed: false, reason: "Offer PDF already generated — one-time access consumed" }
  }
  return { allowed: true }
}
