import type { Metadata } from "next";
import { OrderStatusPage } from "@gmd/order-status/ui";
import * as actions from "./actions";

export const metadata: Metadata = { title: "Order Status | GMD Quotation Process" };

export default function Page() {
  return <OrderStatusPage actions={{ ...actions }} />;
}
