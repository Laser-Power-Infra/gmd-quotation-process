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

  // Fetch paginated enquiries
  const enquiriesList = (
    await prisma.enquiry.findMany({
      where: whereClause,
      include: {
        items: true,
      },
      orderBy: {
        enquiryDate: "desc",
      },
      take: limit,
      skip: skip,
    })
  ).map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="flex-1 flex flex-col p-6 w-full gap-4 max-w-[1600px] mx-auto">
        <Suspense>
          <DashboardHeader enquiries={enquiries} />
        </Suspense>

        <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm flex flex-col flex-1">
          {totalCount === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
                <SearchX className="h-6 w-6 stroke-[1.5]" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                No enquiries found
              </h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                {searchQuery
                  ? `We couldn't find any results matching "${searchQuery}". Try updating your search.`
                  : "Get started by adding items or creating a new enquiry."}
              </p>
              {searchQuery && (
                <div className="mt-4">
                  <a
                    href="/"
                    className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground shadow-sm hover:bg-muted"
                  >
                    Clear Search
                  </a>
                </div>
              )}
            </div>
          ) : (
            <>
              <EnquiryTable enquiries={enquiriesList} />
              <Pagination
                currentPage={currentPage}
                totalCount={totalCount}
                pageSize={limit}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
