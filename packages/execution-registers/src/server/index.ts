import "server-only";

// Reads only: the copies are written by the execution-tracking job in the host app.
export { listRegisterFacet, listRegisterPage } from "./query";
