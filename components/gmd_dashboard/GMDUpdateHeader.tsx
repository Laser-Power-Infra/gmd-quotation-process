import { RefreshCw, Loader2 } from "lucide-react";

interface GMDUpdateHeaderProps {
  totalRows: number;
  syncedAt?: string | null;
  onSync?: () => void;
  syncing?: boolean;
  onRecompute?: () => void;
  recomputing?: boolean;
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

export default function GMDUpdateHeader({
  totalRows,
  syncedAt = null,
  onSync,
  syncing,
  onRecompute,
  recomputing,
  title = "GMD UPDATE",
}: GMDUpdateHeaderProps) {
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
      {/* {(onSync || onRecompute) && (
        <div className="flex items-center gap-2">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {syncing ? "Syncing..." : "Sync"}
            </button>
          )}
          {onRecompute && (
            <button
              onClick={onRecompute}
              disabled={recomputing}
              className="flex items-center gap-1.5 bg-[#38ef7d]/10 hover:bg-[#38ef7d]/20 border border-[#38ef7d]/30 rounded px-3 py-1.5 text-[11px] font-semibold text-[#38ef7d] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {recomputing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {recomputing ? "Recomputing..." : "Recompute"}
            </button>
          )}
        </div>
      )} */}
    </div>
  );
}