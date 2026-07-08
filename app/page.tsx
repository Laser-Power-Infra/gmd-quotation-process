import React, { Suspense } from "react";
import Navbar from "@/components/layout/Navbar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EnquiryTable from "@/components/table/EnquiryTable";
import Pagination from "@/components/table/Pagination";
import { prisma } from "@/lib/prisma";
import { SearchX, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const page = resolvedSearchParams.page;
  const search = resolvedSearchParams.search;

  const currentPage = Math.max(1, parseInt(page || "1", 10));
  const limit = 10;
  const skip = (currentPage - 1) * limit;
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

  // Fetch count
  const totalCount = await prisma.enquiry.count({
    where: whereClause,
  });

  // Fetch all matching enquiries (pagination is handled client-side inside the table for smooth filtering)
  const enquiriesList = (
    await prisma.enquiry.findMany({
      where: whereClause,
      include: {
        items: {
          orderBy: {
            createdAt: "asc"
          }
        },
        attachments: true,
      },
      // orderBy: {
      //   enquiryDate: "desc",
      // },
    })
  ).map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      productCost: item.productCost ? Number(item.productCost) : null,
      cost: item.cost ? Number(item.cost) : null,
      discount: item.discount ? Number(item.discount) : null,
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

  // Get unique options for filters and dropdowns from the database
  const [
    dbEnquiryTypes,
    dbStates,
    dbPaymentTerms,
    dbInspections,
    dbPbgs,
    dbUtilities,
    dbVaPercents,
    dbOrderStatuses,
    dbItemTypes,
    dbMocs,
    dbSizes,
    dbPnRatings,
    dbOperationTypes,
    dbExtensions,
    dbBypasses,
  ] = await Promise.all([
    prisma.enquiry.findMany({ select: { enquiryType: true }, distinct: ["enquiryType"] }),
    prisma.enquiry.findMany({ select: { state: true }, distinct: ["state"] }),
    prisma.enquiry.findMany({ select: { paymentTerms: true }, distinct: ["paymentTerms"] }),
    prisma.enquiry.findMany({ select: { inspection: true }, distinct: ["inspection"] }),
    prisma.enquiry.findMany({ select: { pbg: true }, distinct: ["pbg"] }),
    prisma.enquiry.findMany({ select: { utility: true }, distinct: ["utility"] }),
    prisma.enquiry.findMany({ select: { vaPercent: true }, distinct: ["vaPercent"] }),
    prisma.enquiry.findMany({ select: { orderStatus: true }, distinct: ["orderStatus"] }),
    prisma.enquiryItem.findMany({ select: { itemType: true }, distinct: ["itemType"] }),
    prisma.enquiryItem.findMany({ select: { moc: true }, distinct: ["moc"] }),
    prisma.enquiryItem.findMany({ select: { size: true }, distinct: ["size"] }),
    prisma.enquiryItem.findMany({ select: { pnRating: true }, distinct: ["pnRating"] }),
    prisma.enquiryItem.findMany({ select: { operationType: true }, distinct: ["operationType"] }),
    prisma.enquiryItem.findMany({ select: { extension: true }, distinct: ["extension"] }),
    prisma.enquiryItem.findMany({ select: { bypass: true }, distinct: ["bypass"] }),
  ]);

  const getUniqueOptions = (arr: any[], key: string) =>
    Array.from(new Set(arr.map((item) => item[key]).filter((val) => val !== null && val !== undefined && val !== "")))
      .sort((a: any, b: any) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  const staticItemTypes = [
    "ACTUATOR",
    "AIR CUSHION VALVE",
    "AIR VACCUM VALVE",
    "AIR VALVE",
    "ALTITUDE CONTROL VALVE",
    "BALL VALVE",
    "BOLTS OR NUTS",
    "BUSH",
    "BUSH PLATE",
    "BUTTERFLY VALVE",
    "CHECK VALVE",
    "COMPANION FLANGE",
    "COTTER PIN",
    "DEAD END COVER",
    "DIGITAL PRESSURE GAUGE",
    "DISC SEAT RING",
    "DISMANTLING JOINT",
    "DOWEL PIN & WASHER",
    "DPCV",
    "DRUM PLATE",
    "EXPANSION BELOWS",
    "FIRE HYDRANT VALVE",
    "FLAP VALVE",
    "FLOAT VALVE",
    "FOOT VALVE",
    "GASKET",
    "GAZAL",
    "GEAR BOX",
    "GLOBE VALVE",
    "H.P. ORIFICE SMALL CHAMBER",
    "KNIFE GATE VALVE",
    "LP SEAT RING",
    "MS REDUCER",
    "MS ROD",
    "NEEDLE VALVE",
    "O-RING",
    "OTHERS",
    "PLUG VALVE",
    "PRESSURE REDUCING VALVE",
    "PRESSURE RELIEF VALVE",
    "RETAINER RING",
    "RING",
    "SEAL RING",
    "SEAL RING, DISC SEAT RING",
    "SHAFT",
    "SLUICE GATE",
    "SLUICE VALVE-METAL-NON-RISING",
    "SLUICE VALVE-METAL-RISING",
    "SLUICE VALVE-RESILIENT-NON-RISING",
    "SLUICE VALVE-RESILIENT-RISING",
    "SMALL ORIFICE SET",
    "SOLENOID VALVE",
    "SPINDLE",
    "TIE ROD",
    "TPAV",
    "UPPER SHAFT",
    "VACUM BREAKER VALVE",
    "WASHER",
    "WASTAGE",
    "WEDGE NUT",
    "WIRE NAIL",
    "Y-STRAINER",
    "ZERO VELOCITY VALVE"
  ];

  const itemTypes = Array.from(new Set([...staticItemTypes, ...getUniqueOptions(dbItemTypes, "itemType")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticMocs = [
    "DUCTILE IRON/CAST IRON",
    "MILD STEEL",
    "CAST STEEL/CARBON STEEL",
    "ACTUATOR",
    "RUBBER",
    "OTHERS",
    "CAPEX",
    "STAINLESS STEEL",
    "GUN METAL/ BRASS",
    "LEATHER",
    "FORGED STEEL",
    "MONEL STEEL",
    "WOODEN",
    "GALVANISED"
  ];

  const mocs = Array.from(new Set([...staticMocs, ...getUniqueOptions(dbMocs, "moc")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticPnRatings = [
    "PN-10/16",
    "PN-20/25/30",
    "NA",
    "CLASS-600#",
    "CLASS-150#",
    "CLASS-300#",
    "CLASS-800#"
  ];

  const pnRatings = Array.from(new Set([...staticPnRatings, ...getUniqueOptions(dbPnRatings, "pnRating")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticOperationTypes = [
    "CAP",
    "STANDARD",
    "GB",
    "PNEUMATIC",
    "ACT",
    "ACT+GB",
    "GB/LEVER",
    "HYDRAULIC ACT",
    "WITH ISOLATION METAL SLUICE NON-RISING",
    "WITH ISOLATION RESILIENT SLUICE NON-RISING",
    "SPARES",
    "WITH ISOLATION RESILIENT SLUICE RISING",
    "WITH ISOLATION METAL SLUICE RISING",
    "WITH ISOLATION BUTTERFLY VALVE"
  ];

  const operationTypes = Array.from(new Set([...staticOperationTypes, ...getUniqueOptions(dbOperationTypes, "operationType")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticExtensions = [
    "1",
    "8",
    "3",
    "4",
    "4.5",
    "6",
    "5",
    "2",
    "0"
  ];

  const extensions = Array.from(new Set([...staticExtensions, ...getUniqueOptions(dbExtensions, "extension")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticBypasses = [
    "40",
    "50",
    "65",
    "80",
    "100",
    "125",
    "150",
    "200",
    "250",
    "300",
    "25"
  ];

  const staticEnquiryTypes = [
    "PURCHASE",
    "BUDGETARY",
    "TENDER"
  ];

  const staticStates = [
    "ANDHRA PRADESH",
    "ARUNACHAL PRADESH",
    "ASSAM",
    "BIHAR",
    "CHHATTISGARH",
    "GOA",
    "GUJARAT",
    "HARYANA",
    "HIMACHAL PRADESH",
    "JHARKHAND",
    "KARNATAKA",
    "KERALA",
    "MADHYA PRADESH",
    "MAHARASHTRA",
    "MANIPUR",
    "MEGHALAYA",
    "MIZORAM",
    "NAGALAND",
    "ODISHA",
    "PUNJAB",
    "RAJASTHAN",
    "SIKKIM",
    "TAMIL NADU",
    "TELANGANA",
    "TRIPURA",
    "UTTAR PRADESH",
    "UTTARAKHAND",
    "WEST BENGAL"
  ];

  const states = Array.from(new Set([...staticStates, ...getUniqueOptions(dbStates, "state")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const bypasses = Array.from(new Set([...staticBypasses, ...getUniqueOptions(dbBypasses, "bypass")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const enquiryTypes = Array.from(new Set([...staticEnquiryTypes, ...getUniqueOptions(dbEnquiryTypes, "enquiryType")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticPaymentTerms = [
    "20% advance against order & 80 % Against Proforma Invoice immediately after Inspection.",
    "20% advance against order & 80 % Within 30 Days from the date of receipt of material at site.",
    "30 days Open credit from date of Dispatch of material",
    "60 days Open credit from date of Dispatch of material",
    "60 days Letter of credit prior to date of supply with interest in Buyer Account",
    "30 days Letter of credit prior to date of supply with interest in Buyer Account",
    "60 days Letter of credit prior to date of supply with interest in Seller Account",
    "30 days Letter of credit prior to date of supply with interest in Seller Account",
    "90 days Letter of credit prior to date of supply with interest in Buyer Account",
    "90 days Letter of credit prior to date of supply with interest in Seller'S Account",
    "90 days Open credit from date of Dispatch of material",
    "45 days Open credit from date of Dispatch of material",
    "60 days PDC prior to date of supply.",
    "07 days Open credit from date of Dispatch of material",
    "180 days Letter of credit prior to date of supply with interest in Seller'S Account",
    "100 % Against Proforma Invoice Prior To Dispatch.",
    "15% Advance Along With PO and Balance 85% Against Proforma Invoice Prior To Dispatch",
    "20% Advance Along With PO and Balance 80% Against 45 Days Bank L/c Prior To Dispatch",
    "90 days hundi: against MRN & BILL SUBMISSION whichever is later",
    "45 days Letter of credit from date of Dispatch of material",
    "180 days VFS  with interest in Seller'S Account"
  ];

  const paymentTerms = Array.from(new Set([...staticPaymentTerms, ...getUniqueOptions(dbPaymentTerms, "paymentTerms")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticInspections = [
    "Client Scope @ 0.75%",
    "Client Scope @ 1%",
    "Client Scope @ 1.25%",
    "Client Scope @ 1.5%",
    "Client Scope @ 1.75%",
    "Client Scope @ 2%",
    "Our Scope @ 1%",
    "Our Scope @ 1.25%",
    "Our Scope @ 1.5%",
    "Our Scope @ 1.75%",
    "Our Scope @ 2%",
    "NA"
  ];

  const inspections = Array.from(new Set([...staticInspections, ...getUniqueOptions(dbInspections, "inspection")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticPbgs = [
    "5% For 24 Months from date of invoice.",
    "7.5% For 24 Months from date of invoice.",
    "10% For 24 Months  from date of invoice.",
    "5% For 36 Months  from date of invoice.",
    "7.5% For 36 Months  from date of invoice.",
    "10% For 36 Months  from date of invoice.",
    "5% For 60 Months  from date of invoice.",
    "7.5% For 60 Months from date of invoice.",
    "10% For 60 Months  from date of invoice.",
    "5% For 66 Months  from date of invoice.",
    "7.5% For 66 Months  from date of invoice.",
    "10% For 66 Months  from date of invoice.",
    "NA",
    "2.5% For 24 Months from date of invoice.",
    "10% For 12 Months from date of invoice.",
    "2.5% For 36 Months  from date of invoice.",
    "10% For 90days beyond DLP of 10 yrs from date of invoice.",
    "5% For 4 Months from date of invoice.",
    "5% For 3 Months from date of invoice.",
    "5% For 6 Months from date of invoice.",
    "10% For 15 Months from date of invoice.",
    "5% For 17 Months from date of invoice.",
    "10% For 21 Months from date of invoice.",
    "10% For 45 Months from date of invoice.",
    "10% For 69 Months from date of invoice.",
    "10% For 29 Months from date of invoice.",
    "3% For 16 Months from date of invoice.",
    "3% For 27 Months from date of invoice.",
    "5% For 21 Months from date of invoice.",
    "5% For 31 Months from date of invoice.",
    "5% For 14 Months from date of invoice.",
    "10% For 24 Months beyond DLP of 30 days from date of invoice.",
    "3% For 23 Months from date of invoice.",
    "5% For 5 Months  from date of invoice.",
    "5% For 12 Months from date of invoice.",
    "10% For 14 Months from date of invoice.",
    "3% For 25 Months from date of invoice.",
    "3% For 24 Months from date of invoice.",
    "5% For 22 Months from date of invoice.",
    "5% For 7 Months from date of invoice.",
    "5% For 19 Months from date of invoice.",
    "1% For 36 Months  from date of invoice."
  ];

  const pbgs = Array.from(new Set([...staticPbgs, ...getUniqueOptions(dbPbgs, "pbg")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staticOrderStatuses = [
    "PENDING",
    "LOST",
    "ORDER RECVD"
  ];

  const orderStatuses = Array.from(new Set([...staticOrderStatuses, ...getUniqueOptions(dbOrderStatuses, "orderStatus")]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const dropdownOptions = {
    enquiryTypes,
    states,
    paymentTerms,
    inspections,
    pbgs,
    utilities: getUniqueOptions(dbUtilities, "utility") as string[],
    vaPercents: getUniqueOptions(dbVaPercents, "vaPercent").map(v => `${v}%`),
    orderStatuses,
    itemTypes,
    mocs,
    sizes: Array.from(new Set(["15", "25", "40", "65", ...getUniqueOptions(dbSizes, "size")]))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) as string[],
    pnRatings,
    operationTypes,
    extensions,
    bypasses,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="flex-1 flex flex-col p-6 w-full gap-4 max-w-[1600px] mx-auto">
        <Suspense>
          <DashboardHeader
            enquiries={enquiries}
            nextDocketNumber={nextDocketNumber}
            dropdownOptions={dropdownOptions}
          />
        </Suspense>

        <div className="bg-white rounded-lg border border-slate-100 overflow-hidden shadow-sm flex flex-col flex-1">
          <EnquiryTable enquiries={enquiriesList} dropdownOptions={dropdownOptions} />
        </div>
      </main>
    </div>
  );
}
// Touched to reload generated client
