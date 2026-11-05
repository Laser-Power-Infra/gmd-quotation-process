import type { Metadata } from "next";
import { EntryHistoryPage } from "@gmd/physical-stock/history";
import { isPrivileged } from "@/lib/auth-helpers";
import { loadEntries, restoreEntry, revertEntry } from "./actions";

export const metadata: Metadata = {
  title: "Entry History | Stock Physical Dashboard",
};

export default async function Page() {
  const canRevert = await isPrivileged();
  const privileged = canRevert ? { revertEntry, restoreEntry } : {};
  return <EntryHistoryPage actions={{ loadEntries, ...privileged }} canRevert={canRevert} />;
}
