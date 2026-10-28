import "server-only";
import {
  resolveContractReviewFlags,
  type ContractReviewFlags,
  type ContractReviewHeader,
} from "@gmd/contract-review/flags";
import {
  contractReviewDisabledColumns,
  contractReviewExcelExport,
  contractReviewFlowDiagram,
  contractReviewHiddenSidebar,
  contractReviewReadOnlyColumns,
} from "@/flags";
import { getCurrentUser } from "@/lib/auth-helpers";

/** Editable by the admin role only; everyone else sees them read-only. */
const ADMIN_ONLY_COLUMNS: ContractReviewHeader[] = ["PO NO", "DATE OF CONTRACT"];

/** Evaluates this app's Contract Review flags for the current request. */
export async function getContractReviewFlags(): Promise<ContractReviewFlags> {
  const [disabledColumns, readOnlyColumns, flowDiagram, excelExport, hiddenSidebar, user] =
    await Promise.all([
      contractReviewDisabledColumns(),
      contractReviewReadOnlyColumns(),
      contractReviewFlowDiagram(),
      contractReviewExcelExport(),
      contractReviewHiddenSidebar(),
      getCurrentUser(),
    ]);
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  return resolveContractReviewFlags({
    disabledColumns,
    readOnlyColumns: isAdmin ? readOnlyColumns : [...readOnlyColumns, ...ADMIN_ONLY_COLUMNS],
    flowDiagram,
    excelExport,
    hiddenSidebar,
  });
}
