import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import {
  isSrInvoice,
  normalizeBg,
  normalizePo,
} from "@/lib/pbg/supply-history";

export type InvoiceLookupRow = {
  bgNo: string | null;
  poNumber: string | null;
};

export type InvoiceLookup = {
  byBg: Map<string, string[]>;
  byPo: Map<string, string[]>;
};

function isUsableKey(value: string): boolean {
  return value !== "" && value !== "0" && value !== "-" && value !== "--";
}

function sorted(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export async function loadInvoiceLookup(
  rows: InvoiceLookupRow[],
): Promise<InvoiceLookup> {
  const byBg = new Map<string, Set<string>>();
  const byPo = new Map<string, Set<string>>();

  const bgValues = Array.from(
    new Set(rows.map((row) => normalizeBg(row.bgNo)).filter(isUsableKey)),
  );
  const poValues = Array.from(
    new Set(
      rows
        .map((row) => normalizePo(row.poNumber ?? ""))
        .filter(isUsableKey),
    ),
  );

  if (bgValues.length === 0 && poValues.length === 0) {
    return { byBg: new Map(), byPo: new Map() };
  }

  const or: Prisma.SupplyHistoryItemWhereInput[] = [];
  if (bgValues.length > 0) {
    or.push({ bgNo: { in: bgValues, mode: "insensitive" } });
  }
  if (poValues.length > 0) {
    or.push({ partyOrderNo: { in: poValues, mode: "insensitive" } });
  }

  const history = await prisma.supplyHistoryItem.findMany({
    where: { OR: or },
    select: { bgNo: true, partyOrderNo: true, invoiceNo: true },
  });

  for (const item of history) {
    const invoice = String(item.invoiceNo ?? "").trim();
    if (!invoice || isSrInvoice(invoice)) continue;

    const bgKey = normalizeBg(item.bgNo);
    if (isUsableKey(bgKey)) {
      const values = byBg.get(bgKey) ?? new Set<string>();
      values.add(invoice);
      byBg.set(bgKey, values);
    }

    const poKey = normalizePo(item.partyOrderNo ?? "");
    if (isUsableKey(poKey)) {
      const values = byPo.get(poKey) ?? new Set<string>();
      values.add(invoice);
      byPo.set(poKey, values);
    }
  }

  return {
    byBg: new Map(
      Array.from(byBg, ([key, values]) => [key, sorted(values)]),
    ),
    byPo: new Map(
      Array.from(byPo, ([key, values]) => [key, sorted(values)]),
    ),
  };
}

export function invoiceNumbersForRow(
  row: InvoiceLookupRow,
  lookup: InvoiceLookup,
): string[] {
  const bgKey = normalizeBg(row.bgNo);
  const fromBg = isUsableKey(bgKey) ? lookup.byBg.get(bgKey) : undefined;
  if (fromBg && fromBg.length > 0) return fromBg;

  const poKey = normalizePo(row.poNumber ?? "");
  return (
    (isUsableKey(poKey) ? lookup.byPo.get(poKey) : undefined) ?? []
  );
}
