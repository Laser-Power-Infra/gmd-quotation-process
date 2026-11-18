import type { Metadata } from "next";
import { ServiceOrdersPage } from "@gmd/service-orders/ui";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Service / Work Orders | GMD One Person Lead Framework",
  description: "Open service and job-work orders, days pending and receipts pending.",
};

export default function Page() {
  return <ServiceOrdersPage actions={{ ...actions }} />;
}
