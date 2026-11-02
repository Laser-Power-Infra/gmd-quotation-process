export const UNASSIGNED = "__unassigned__";

/** Monday 00:00 local of the week containing `now`, and the next Monday. */
export function weekWindow(now: Date): [Date, Date] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)];
}

/** True when a date-only / ISO string falls in the Mon-Sun week of `now`. Uses the YYYY-MM-DD part as a local date. */
export function inThisWeek(value: string | null | undefined, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const [s, e] = weekWindow(now);
  return d >= s && d < e;
}

/** Promised-this-week total: the amount is free text ("1,50,000"), unparseable counts as 0. */
export function promisedThisWeek(items: { promisedDate: string | null; promisedAmount: string | null }[], now: Date) {
  let total = 0, count = 0;
  for (const i of items) {
    if (!inThisWeek(i.promisedDate, now)) continue;
    count += 1;
    const n = Number((i.promisedAmount ?? "").replace(/[₹,\s]/g, ""));
    if (Number.isFinite(n)) total += n;
  }
  return { total, count };
}

export const topByOverdue = <T extends { overdue: number }>(parties: T[], n = 10): T[] =>
  parties.filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, n);

export const ownerMatches = (owner: string | null | undefined, filter: string) =>
  !filter || (filter === UNASSIGNED ? !owner : owner === filter);
