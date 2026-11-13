import "server-only";
import {
  fillOnceColumns,
  resolveContractReviewFlags,
  type ContractReviewFlags,
} from "@gmd/contract-review/flags";
import {
  contractReviewDisabledColumns,
  contractReviewExcelExport,
  contractReviewFlowDiagram,
  contractReviewHiddenSidebar,
  contractReviewReadOnlyColumns,
} from "@/flags";
import { auth } from "@/auth";

/** Evaluates this app's Contract Review flags for the current request. */
export async function getContractReviewFlags(): Promise<ContractReviewFlags> {
  const [disabledColumns, readOnlyColumns, flowDiagram, excelExport, hiddenSidebar, session] =
    await Promise.all([
      contractReviewDisabledColumns(),
      contractReviewReadOnlyColumns(),
      contractReviewFlowDiagram(),
      contractReviewExcelExport(),
      contractReviewHiddenSidebar(),
      auth(),
    ]);
  return resolveContractReviewFlags({
    disabledColumns,
    readOnlyColumns,
    blankOnlyColumns: fillOnceColumns(session?.user?.role),
    flowDiagram,
    excelExport,
    hiddenSidebar,
  });
}
