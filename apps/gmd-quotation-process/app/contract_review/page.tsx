import { ContractReviewPage } from "@gmd/contract-review/ui";
import {
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
} from "@/app/actions";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import * as core from "./actions";
import {
  loadAllRows,
  loadFacet,
  loadView,
  runBackfillsAction,
} from "./viewActions";

export default async function Page() {
  return (
    <ContractReviewPage
      flags={await getContractReviewFlags()}
      actions={{
        ...core,
        // Server view: one filtered page + aggregates per request, instead of
        // shipping every row to the browser.
        loadView,
        loadFacet,
        loadAllRows,
        runBackfillsAction,
        backfillEndpoint: "/api/contract-review/backfill",
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
