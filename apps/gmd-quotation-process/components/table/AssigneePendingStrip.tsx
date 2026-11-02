"use client";

/** "Who does what": open dockets per owner of their current stage. */

import { useMemo } from "react";
import { STAGE_ASSIGNEE_LABEL, type AssigneeStage } from "@/lib/stageAgeing";
import type { EnquirySummary } from "@/lib/enquiryQuery";

export default function AssigneePendingStrip({ rows }: { rows: EnquirySummary["assigneePending"] }) {
  const people = useMemo(() => {
    const byUser = new Map<string, { name: string; unassigned: boolean; total: number; stages: Record<string, number> }>();
    for (const r of rows) {
      const key = r.userId ?? "";
      const p = byUser.get(key) ?? { name: r.name, unassigned: !r.userId, total: 0, stages: {} };
      p.total += r.count;
      p.stages[r.stage] = (p.stages[r.stage] ?? 0) + r.count;
      byUser.set(key, p);
    }
    return [...byUser.values()].sort(
      (a, b) => Number(a.unassigned) - Number(b.unassigned) || b.total - a.total,
    );
  }, [rows]);

  if (people.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b border-border">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pending by person</span>
      {people.map((p) => (
        <span
          key={p.name + p.unassigned}
          className={`rounded-md border border-border px-2 py-0.5 text-[11px] ${p.unassigned ? "text-muted-foreground italic" : "text-foreground"}`}
        >
          <span className="font-semibold">{p.name}</span> — {p.total}{" "}
          <span className="text-muted-foreground">
            ({Object.entries(p.stages)
              .map(([s, n]) => `${STAGE_ASSIGNEE_LABEL[s as AssigneeStage] ?? s} ${n}`)
              .join(", ")})
          </span>
        </span>
      ))}
    </div>
  );
}
