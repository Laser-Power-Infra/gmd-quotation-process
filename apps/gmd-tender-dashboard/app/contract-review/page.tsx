import { ContractReviewPage } from "@gmd/contract-review/ui";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import * as actions from "./actions";
import { loadAllRows, loadFacet, loadView } from "./viewActions";

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default async function Page() {
  return <ContractReviewPage actions={{ ...actions, loadView, loadFacet, loadAllRows }} flags={await getContractReviewFlags()} />;
}
