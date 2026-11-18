import type { Metadata } from "next";
import { SalesRegisterPage } from "@gmd/sales-register/ui";
import * as actions from "./actions";

export const metadata: Metadata = { title: "Sales Register | GMD Quotation Process" };

export default function Page() {
  return <SalesRegisterPage actions={{ ...actions }} />;
}
