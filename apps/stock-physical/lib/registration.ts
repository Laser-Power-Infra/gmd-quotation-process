// Self sign-up is limited to company domains, and new accounts wait for an admin.
export const ALLOWED_EMAIL_DOMAINS = ["laserpowerinfra.com", "gmdalui.co.in"]

// Stored in the existing User.role column; an admin approves by setting role to "user".
export const PENDING_ROLE = "pending"

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isAllowedEmailDomain(email: string) {
  const parts = normalizeEmail(email).split("@")
  return parts.length === 2 && ALLOWED_EMAIL_DOMAINS.includes(parts[1])
}
