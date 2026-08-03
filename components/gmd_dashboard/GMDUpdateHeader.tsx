import { RotateCcw, Loader2 } from "lucide-react";

interface GMDUpdateHeaderProps {
  totalRows: number;
  syncedAt?: string | null;
  onSync?: () => void;
  syncing?: boolean;
  title?: string;
}

function formatSyncTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  try {
    const d = new Date(dateStr);
   return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "Unknown";
  }
}

export default function GMDUpdateHeader({ totalRows, syncedAt = null, onSync, syncing, title = "GMD UPDATE" }: GMDUpdateHeaderProps) {
  return (
    <div className="bg-[#0a2540] px-6 py-3 border-b border-[#1e3d59] flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white">{title}</h2>
        <span className="bg-[#1e3d59] text-[#38ef7d] text-[11px] font-semibold px-3 py-1 rounded-full">
          {totalRows} items
        </span>
        {syncedAt !== undefined && (
          <span className="text-[11px] text-white/50 font-medium">
            Last synced: {formatSyncTime(syncedAt)}
          </span>
        )}
      </div>
      {onSync && (
        <div className="flex items-center gap-2">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1.5 text-[11px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>
      )}
    </div>
  );
}
