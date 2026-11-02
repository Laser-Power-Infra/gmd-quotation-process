import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Read-only: top 30 items by totalValue, plus items whose totalValue differs from
 * quantity x quotedRate x 1.18 by more than 1%. Same exclusions as the dashboard totals.
 * Usage: npx tsx scripts/list-total-outliers.ts
 */

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
};

async function main() {
  const items = await prisma.enquiryItem.findMany({
    where: {
      totalValue: { not: null },
      enquiry: { NOT: { duplicate: { equals: "Yes" } } },
      NOT: [{ cBatch: "C" }, { nBatch: "N" }],
    },
    select: { id: true, itemName: true, quantity: true, quotedRate: true, totalValue: true, enquiry: { select: { docketNumber: true } } },
  });

  const rows = items.flatMap((i) => {
    const total = num(i.totalValue);
    if (total === null) return [];
    const qty = num(i.quantity);
    const rate = num(i.quotedRate);
    const expected = qty !== null && rate !== null ? qty * rate * 1.18 : null;
    return [{ docket: i.enquiry.docketNumber, id: i.id, item: i.itemName, qty, rate, total, expected }];
  });

  console.log("\n=== Top 30 by totalValue ===");
  console.table([...rows].sort((a, b) => b.total - a.total).slice(0, 30));

  const off = rows.filter((r) => r.expected !== null && Math.abs(r.total - r.expected) > 0.01 * Math.abs(r.expected));
  console.log(`\n=== totalValue != qty x quotedRate x 1.18 by >1% (${off.length}) ===`);
  console.table(off);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
