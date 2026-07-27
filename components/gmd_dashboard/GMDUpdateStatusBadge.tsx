const statusColorMap: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  REJECTED: "bg-red-100 text-red-800",
  ACTIVE: "bg-green-100 text-green-800",
  INACTIVE: "bg-slate-100 text-slate-600",
  NEW: "bg-blue-100 text-blue-800",
  DRAFT: "bg-slate-100 text-slate-600",
  SUBMITTED: "bg-indigo-100 text-indigo-800",
  REVIEW: "bg-orange-100 text-orange-800",
};

export default function GMDUpdateStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value || value.trim() === "") {
    return <span className="text-on-surface-variant text-body-sm">—</span>;
  }

  const upper = value.toUpperCase().trim();
  const colorClass = statusColorMap[upper] ?? "bg-surface-container-high text-on-surface-variant";

  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-tighter ${colorClass}`}>
      {upper}
    </span>
  );
}
