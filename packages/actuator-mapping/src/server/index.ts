import "server-only";

// Reads only: the actuator workbook import (the host's scripts/import-actuator-master) writes these tables.
export { listFacet, listPage } from "./query";
