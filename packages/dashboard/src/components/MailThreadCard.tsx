import { Badge } from "@gmd/ui/components/badge";
import { Calendar, ExternalLink, Mail, Paperclip } from "lucide-react";

/** One mail thread as the docket follow-up "All Messages" tab shows it. */
export interface MailThread {
  subject: string | null;
  sender: string | null;
  /** ISO timestamp. */
  date: string | null;
  actionTag?: string | null;
  bodyPreview?: string | null;
  /** A null url renders the name without a link. */
  attachments: { name: string; url: string | null }[];
  /** Adds an "Open in Gmail" link when set. */
  gmailUrl?: string;
}

/** Card for one thread; shared by the docket follow-up dashboard and Contract Review "Docket mails". */
export default function MailThreadCard({ thread: t, index }: { thread: MailThread; index: number }) {
  return (
    <div className="p-4 rounded-xl border border-border bg-card space-y-2 text-xs shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-muted text-muted-foreground font-mono">
            #{index + 1}
          </span>
          <span className="font-bold text-sm text-foreground">{t.subject || "(No Subject)"}</span>
        </div>
        {t.date && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(t.date).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <div>
          <span className="font-semibold text-foreground/80">From:</span>{" "}
          <span className="font-mono">{t.sender || "N/A"}</span>
        </div>
        {t.actionTag && (
          <Badge variant="outline" className="text-[10px]">
            {t.actionTag}
          </Badge>
        )}
        {t.gmailUrl && (
          <a
            href={t.gmailUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 hover:underline"
          >
            <Mail className="w-3.5 h-3.5 shrink-0" />
            Open in Gmail
            <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
          </a>
        )}
      </div>

      {t.bodyPreview && (
        <div className="p-3 bg-muted/40 rounded-lg border border-border/60 font-mono text-[11.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {t.bodyPreview}
        </div>
      )}

      {t.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {t.attachments.map((att, aIdx) =>
            att.url ? (
              <a
                key={aIdx}
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-blue-50 hover:bg-blue-100 dark:hover:bg-blue-500/20 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20 transition-colors"
              >
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]">{att.name}</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
              </a>
            ) : (
              <span
                key={aIdx}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-muted text-muted-foreground border border-border"
              >
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]">{att.name}</span>
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
