import "server-only";

// Reads only: Supply History is written by the SALE BILL / MASTER sync in the host app.
export { listSalesFacet, listSalesPage } from "./query";
export type { CostOf, LineCost, SaleCostInput } from "./query";
