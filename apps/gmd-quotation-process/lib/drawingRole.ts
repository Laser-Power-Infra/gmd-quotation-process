import type { DrawingRole } from "@gmd/drawings/columns";

/**
 * The Drawings role of a signed-in user (null when signed out): an email in the verifier list
 * (any case) verifies, admins and developers edit, everyone else only views and downloads.
 */
export function drawingRole(
  email: string | null | undefined,
  role: string | null | undefined,
  verifiers: readonly string[],
): Exclude<DrawingRole, "api"> | null {
  const me = email?.trim().toLowerCase();
  if (!me) return null;
  if (verifiers.some((v) => v.trim().toLowerCase() === me)) return "verifier";
  return role === "admin" || role === "developer" ? "editor" : "viewer";
}
