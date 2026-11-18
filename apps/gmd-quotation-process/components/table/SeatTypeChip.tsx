import { itemSeatType, needsSeatType } from "@/lib/seatType";
import type { EnquiryItemData } from "@/lib/types";
import { cn } from "@/lib/utils";

const FROM = { BOQ: "the BOQ text (item name)", ITEM: "the item type / details", SPEC: "the docket spec" } as const;

/** Seat type under VA% on valve and actuator lines (it sets the sluice / check valve minimum VA%); red when no source names it. */
export default function SeatTypeChip({ item, spec }: { item: EnquiryItemData; spec?: string | null }) {
  if (!needsSeatType(item.itemType)) return null;
  const s = itemSeatType({ ...item, seatSpec: spec });
  return (
    <span
      title={s.source ? `Seat type read from ${FROM[s.source]}${s.source === "SPEC" ? `: "${spec}"` : ""}` : "No seat keyword in the BOQ text, item details or docket spec"}
      className={cn("block w-full text-[9px] text-right px-1 font-bold whitespace-nowrap", s.seat ? "text-muted-foreground" : "text-red-700 dark:text-red-300")}
    >
      {s.seat ? `${s.seat} · ${s.source}` : s.flag}
    </span>
  );
}
