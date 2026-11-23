import "server-only";

// Reads only: the host writes these tables (its lib/actuatorTablesSync: the refresh from the live sheet, and the workbook import script).
export { listFacet, listPage } from "./query";
