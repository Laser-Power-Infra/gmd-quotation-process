/** Vercel sets VERCEL itself; the local server does not, so it stays open to everyone. */
export const isRestricted = () => !!process.env.VERCEL;

/** Throws unless the deployment is open or the caller is an admin/developer. Call first in every action. */
export async function requireAccess() {
  if (!isRestricted()) return;
  // Lazy so tests (and open deployments) never load next-auth and the database.
  const { requireAdminOrDeveloper } = await import("@/lib/auth-helpers");
  await requireAdminOrDeveloper();
}

/**
 * The Drawings surface only (app/drawings/actions.ts): on the hosted site any signed-in user gets in,
 * and the drawings rights model (verifier / editor / viewer) decides what they may change. Open on the LAN server.
 */
export async function requireDrawingsAccess() {
  if (!isRestricted()) return;
  const { auth } = await import("@/auth");
  if (!(await auth())?.user) throw new Error("Unauthorized: sign in");
}

/** Hosted-site page gate (proxy.ts): admin/developer anywhere; any signed-in user on /drawings only. */
export function hostedPageAllowed(pathname: string, user: { role?: string } | null | undefined) {
  if (user?.role === "admin" || user?.role === "developer") return true;
  return !!user && pathname === "/drawings";
}

/**
 * Dashboard edits need a signed-in user on every server (any role).
 * Returns the error result to send back, or null. Returned, not thrown: Next hides thrown messages in production.
 */
export async function loginRequired() {
  const { auth } = await import("@/auth");
  return (await auth())?.user ? null : { success: false as const, error: "Please log in to edit." };
}

/** Route-handler form: a 401 Response to return, or null when allowed. */
export async function denyIfNoAccess(): Promise<Response | null> {
  try {
    await requireAccess();
    return null;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
