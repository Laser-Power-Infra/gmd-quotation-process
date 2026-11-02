import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import type { ReportData } from "@/lib/inspectionReport";
import { ReportEditor } from "./report-editor";

export const metadata: Metadata = {
  title: "Inspection Report | GMD One Person Lead Framework",
};

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.inspectionReport.findUnique({
    where: { id },
    include: { offer: { select: { vrno: true } } },
  });
  if (!report) notFound();

  return (
    <main className="h-[calc(100vh-64px)] overflow-auto bg-background p-3">
      <ReportEditor
        id={report.id}
        offerNo={report.offer.vrno}
        initialStatus={report.status}
        initialData={report.data as ReportData}
      />
    </main>
  );
}
