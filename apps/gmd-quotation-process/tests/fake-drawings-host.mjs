// Stand-ins for what the Drawings actions take from the host and the package: the session (auth.ts),
// the verifier flag (flags.ts), next/cache and @gmd/drawings/server. Importing this file makes every
// later import of those resolve here, so the actions run without a request, Next or the tender DB.
import { registerHooks } from "node:module";

// On globalThis: require() and loginRequired's import("@/auth") each load their own copy of this file.
/** @type {{ session: null | { user: { email?: string; role?: string } }; verifiers: string[]; calls: unknown[][]; revalidated: string[]; answers: Record<string, unknown> }} */
export const host = (globalThis.drawingsHost ??= { session: null, verifiers: [], calls: [], revalidated: [], answers: {} });

export const auth = async () => host.session;
export const drawingVerifiers = async () => host.verifiers;
export const revalidatePath = (path) => {
  host.revalidated.push(path);
};

// @gmd/drawings/server: each call is recorded and answered with host.answers[name], else success.
const recorded = (name) => async (...args) => {
  host.calls.push([name, ...args]);
  return host.answers[name] ?? { success: true, data: name };
};
export const listDrawingsPage = recorded("listDrawingsPage");
export const listDrawingsFacet = recorded("listDrawingsFacet");
export const getContractDrawings = recorded("getContractDrawings");
export const suggestNextDrawingNo = recorded("suggestNextDrawingNo");
export const createDrawing = recorded("createDrawing");
export const addFilesOrLinks = recorded("addFilesOrLinks");
export const changeStatus = recorded("changeStatus");
export const newRevision = recorded("newRevision");

const APP = new URL("../", import.meta.url).href;
const STAND_INS = new Set([`${APP}auth.ts`, `${APP}flags.ts`]);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/cache" || specifier === "@gmd/drawings/server") return { url: import.meta.url, shortCircuit: true };
    const resolved = next(specifier, context);
    return STAND_INS.has(resolved.url) ? { url: import.meta.url, shortCircuit: true } : resolved;
  },
});
