import type { Metadata } from "next";
import PurchaseV2 from "./PurchaseV2";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Purchase | GMD One Person Lead Framework",
};

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default function Page() {
  return <PurchaseV2 actions={{ ...actions }} />;
}
