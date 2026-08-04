import React, { Suspense } from "react";
import DashboardContainer from "./DashboardContainer";
import { prisma } from "@/lib/prisma";
import { getActiveLookupValuesByType } from "@/lib/lookup";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search;

  const searchQuery = search || "";

  // Build filter conditions
  const whereClause = searchQuery
    ? {
        OR: [
          {
            docketNumber: { contains: searchQuery, mode: "insensitive" as const },
          },
          {
            partyName: { contains: searchQuery, mode: "insensitive" as const },
          },
          {
            items: {
              some: {
                itemName: { contains: searchQuery, mode: "insensitive" as const },
              },
            },
          },
        ],
      }
    : {};

  // Fetch all matching enquiries (pagination is handled client-side inside the table for smooth filtering)
  const enquiriesList = (
    await prisma.enquiry.findMany({
      where: whereClause,
      include: {
        items: {
          orderBy: {
            position: "asc"
          }
        },
        attachments: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    })
  ).map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      productCost: item.productCost ? Number(item.productCost) : null,
      cost: item.cost ? Number(item.cost) : null,
      discount: item.discount ? Number(item.discount) : null,
      vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
      quotedRate: item.quotedRate || null,
    })),
  }));

  // Fetch enquiries for the Add Items dropdown list
  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
    },
    orderBy: {
      docketNumber: "asc",
    },
  });

  // Find the latest docket number in the database to auto-populate the next one
  const getFiscalYear = (date: Date) => {
    const month = date.getMonth(); // 0-indexed, April is 3
    const year = date.getFullYear();
    const startYear = month >= 3 ? year : year - 1;
    const endYearStr = String(startYear + 1).slice(-2);
    return `${startYear}-${endYearStr}`;
  };

  const currentFiscalYear = getFiscalYear(new Date());
  const fiscalPrefix = `GMD/${currentFiscalYear}/`;

  const enquiriesInFiscal = await prisma.enquiry.findMany({
    where: {
      docketNumber: {
        startsWith: fiscalPrefix,
      },
    },
    select: {
      docketNumber: true,
    },
  });

  let nextSerial = 1;
  if (enquiriesInFiscal.length > 0) {
    const serials = enquiriesInFiscal.map((e) => {
      const parts = e.docketNumber.split("/");
      const lastPart = parts[parts.length - 1];
      return parseInt(lastPart) || 0;
    });
    nextSerial = Math.max(...serials) + 1;
  }
  const nextDocketNumber = `${fiscalPrefix}${nextSerial}`;

  const lookup = await getActiveLookupValuesByType();

  const sortOptions = (arr: string[]) =>
    [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const dropdownOptions = {
    partyNames: sortOptions(lookup.PARTY ?? []),
    enquiryTypes: sortOptions(lookup.ENQUIRY_TYPE ?? []),
    states: sortOptions(lookup.STATE ?? []),
    paymentTerms: sortOptions(lookup.PAYMENT_TERM ?? []),
    inspections: sortOptions(lookup.INSPECTION ?? []),
    pbgs: sortOptions(lookup.PBG ?? []),
    utilities: sortOptions(lookup.UTILITY ?? []),
    vaPercents: [],
    orderStatuses: sortOptions(lookup.ORDER_STATUS ?? []),
    itemTypes: sortOptions(lookup.ITEM_TYPE ?? []),
    mocs: sortOptions(lookup.MOC ?? []),
    sizes: sortOptions(lookup.SIZE ?? []),
    pnRatings: sortOptions(lookup.PN_RATING ?? []),
    operationTypes: sortOptions(lookup.OPERATION_TYPE ?? []),
    extensions: sortOptions(lookup.EXTENSION ?? []),
    bypasses: sortOptions(lookup.BYPASS ?? []),
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1 flex flex-col p-6 w-full gap-4 mx-auto">
        <Suspense>
          <DashboardContainer
            enquiries={enquiriesList}
            dropdownOptions={dropdownOptions}
            nextDocketNumber={nextDocketNumber}
            enquiriesList={enquiries}
          />
        </Suspense>
      </main>
    </div>
  );
}
