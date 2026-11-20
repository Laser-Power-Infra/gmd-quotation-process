import { getDrawingRights } from "@/app/drawings/actions";
import { ContractReviewView } from "./contract-review-view";
import { autoAssignContractReviewBomIdFromActuator, backfillContractReviewCostFromQuotationAction, backfillContractReviewNoUseBatchAction, recomputeIndentListingVersionsAction, selectContractReviewBomIdAction, syncContractReviewEnquiryFieldsAllAction, syncContractReviewEnquiryFieldsBatchAction, syncContractReviewRmAvailAction } from "@/app/actions/contractReview";
import { getActuatorOptionsAction, saveActuatorWithRmCodeAction } from "@/app/actions/gmdUpdate";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import * as core from "./actions";
import { loadCoveredLineIdsAction } from "./actions";
import {
  loadAllRows,
  loadFacet,
  loadView,
} from "./viewActions";

export default async function Page() {
  // Only hides controls; every drawings action checks the caller's role again.
  const rights = await getDrawingRights();
  return (
    <ContractReviewView
      rights={rights.success ? rights.data : { role: "viewer" }}
      loadCoveredLineIds={loadCoveredLineIdsAction}
      flags={await getContractReviewFlags()}
      actions={{
        ...core,
        // Server view: one filtered page + aggregates per request, instead of
        // shipping every row to the browser.
        loadView,
        loadFacet,
        loadAllRows,
        // Quotation-only extras: need the quotation DB / Google Sheets.
        autoAssignContractReviewBomIdFromActuator,
        backfillContractReviewCostFromQuotationAction,
        backfillContractReviewNoUseBatchAction,
        getActuatorOptionsAction,
        recomputeIndentListingVersionsAction,
        saveActuatorWithRmCodeAction,
        selectContractReviewBomIdAction,
        syncContractReviewEnquiryFieldsAllAction,
        syncContractReviewEnquiryFieldsBatchAction,
        syncContractReviewRmAvailAction,
      }}
    />
  );
}
