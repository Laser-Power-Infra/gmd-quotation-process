import type { Metadata } from "next";
import InspectionReportsList from "./InspectionReportsList";
import { loadFacet, loadPage } from "./actions";

export const metadata: Metadata = {
  title: "Inspection Reports | GMD One Person Lead Framework",
  description: "Inspection offers synced from the ERP dump, each with an auto-drafted report.",
};

export default function Page() {
  return <InspectionReportsList actions={{ loadPage, loadFacet }} />;
}
