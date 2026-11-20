// Tones from the GMDUpdateStatusBadge palette (no new colours): ready = positive, a step still
// needed first = warning, nothing available = negative, nothing left to allocate = neutral.
const POSITIVE = "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300";
const WARNING = "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300";
const NEGATIVE = "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
const NEUTRAL = "bg-muted text-muted-foreground"; // Fully offered, Blue Star

const TONE: Record<string, string> = {
  "Ready for inspection call": POSITIVE,
  "Allocated - wiring change required": WARNING,
  "MC pending - stock held": WARNING,
  Partial: WARNING,
  "Not available": NEGATIVE,
};

/** ALLOC STATUS: the engine's status as a badge, the line's flags and machining suggestions under it (full text on hover). */
export function AllocationStatusCell({ status, notes }: { status: string; notes: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5" title={notes || undefined}>
      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE[status] ?? NEUTRAL}`}>{status}</span>
      {notes && <span className="block max-w-full truncate text-[10px] text-muted-foreground">{notes}</span>}
    </span>
  );
}
