import { seatMismatch, type SeatItem } from "@/lib/seatType";

/** Warning beside the item type when the BOQ / docket spec names a seat the category does not (the category sets the minimum VA%). */
export default function SeatTypeChip({ item }: { item: SeatItem }) {
  const warning = seatMismatch(item);
  if (!warning) return null;
  return (
    <span
      title="Check the item category – it sets the minimum VA%"
      className="inline-flex items-center rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
    >
      {warning}
    </span>
  );
}
