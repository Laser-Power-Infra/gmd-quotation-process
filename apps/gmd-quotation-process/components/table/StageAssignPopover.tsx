"use client";

/** Per-docket owners of the Details / Cost / Validation / Send stages. */

import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@gmd/ui/components/popover";
import CellSelect from "./CellSelect";
import { listAssignableUsersAction } from "@/app/actions/enquiry";
import { STAGE_ASSIGNEE_FIELD, STAGE_ASSIGNEE_LABEL, type AssigneeStage } from "@/lib/stageAgeing";
import type { EnquiryData } from "@/lib/types";

type AssignableUser = { id: string; name: string };

// One fetch shared by every row on the page.
let usersPromise: Promise<AssignableUser[]> | null = null;
function useAssignableUsers() {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  useEffect(() => {
    usersPromise ??= listAssignableUsersAction().catch(() => {
      usersPromise = null;
      return [];
    });
    let live = true;
    usersPromise.then((u) => live && setUsers(u));
    return () => {
      live = false;
    };
  }, []);
  return users;
}

const STAGES = Object.keys(STAGE_ASSIGNEE_FIELD) as AssigneeStage[];

export default function StageAssignPopover({
  enquiry,
  onChange,
}: {
  enquiry: EnquiryData;
  onChange: (field: string, value: string) => void;
}) {
  const users = useAssignableUsers();
  const names = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users]);
  const assigned = STAGES.filter((s) => enquiry[STAGE_ASSIGNEE_FIELD[s]]).length;

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        title="Stage owners"
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold text-muted-foreground border border-border hover:bg-accent cursor-pointer"
      >
        <UserRound className="h-3 w-3" />
        {assigned}/{STAGES.length}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-60 rounded border border-border bg-popover text-popover-foreground shadow-lg p-2 flex flex-col gap-1.5"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Owners · {enquiry.docketNumber}
        </span>
        {STAGES.map((stage) => {
          const field = STAGE_ASSIGNEE_FIELD[stage];
          return (
            <CellSelect
              key={stage}
              variant="chip"
              chipLabel={STAGE_ASSIGNEE_LABEL[stage]}
              value={enquiry[field] ?? ""}
              options={users.map((u) => u.id)}
              optionLabels={names}
              placeholder="Unassigned"
              searchPlaceholder="Search people..."
              allowCustomValue
              onChange={(v) => onChange(field, v)}
            />
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
