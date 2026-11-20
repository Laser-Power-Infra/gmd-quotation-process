"use client";

import { ContractReviewPage } from "@gmd/contract-review/ui";
import type { ContractReviewActions } from "@gmd/contract-review/types";
import type { ContractReviewFlags } from "@gmd/contract-review/flags";
import type { DrawingRights } from "@gmd/drawings/ui";
import { drawingActions } from "@/app/drawings/drawings-view";

/** Adds the Drawings & QAP window. A client file because `drawingActions` holds a client adapter, which a server page cannot pass as a prop. */
export function ContractReviewView({
  actions,
  flags,
  rights,
  loadCoveredLineIds,
}: {
  actions: ContractReviewActions;
  flags: ContractReviewFlags;
  rights: DrawingRights;
  loadCoveredLineIds: NonNullable<ContractReviewActions["drawings"]>["loadCoveredLineIds"];
}) {
  return <ContractReviewPage flags={flags} actions={{ ...actions, drawings: { actions: drawingActions, rights, loadCoveredLineIds } }} />;
}
