import { PhysicalStockPage } from "@gmd/physical-stock/ui";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import { isPrivileged } from "@/lib/auth-helpers";
import * as actions from "./actions";

export default async function Page() {
  // Undo on the submit toast only for roles the server lets revert.
  const revertEntry = (await isPrivileged()) ? actions.revertEntry : undefined;
  return <PhysicalStockPage flags={await getPhysicalStockFlags()} actions={{ ...actions, revertEntry }} showHeader={false} />;
}
