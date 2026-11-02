// Client slices import Server Actions, which pull in `server-only`. Next's bundler
// replaces those with RPC stubs; plain node does not, so the module throws. Tests
// only exercise the client half: resolve it to an empty module.
import { registerHooks } from "node:module";

const EMPTY = new URL("./empty-module.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: EMPTY, shortCircuit: true };
    return next(specifier, context);
  },
});
