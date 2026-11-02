import { AlertTriangle } from "lucide-react";
import { isSyncStale } from "../lib/syncStale";
import { formatSyncTime } from "./GMDUpdateHeader";

export default function SyncStaleBanner({
  syncedAt,
}: {
  syncedAt: string | Date | null | undefined;
}) {
  if (!isSyncStale(syncedAt)) return null;
  const when = syncedAt ? formatSyncTime(syncedAt) : "never";
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertTriangle size={14} className="shrink-0" />
      Data may be out of date — last synced {when}.
    </div>
  );
}
