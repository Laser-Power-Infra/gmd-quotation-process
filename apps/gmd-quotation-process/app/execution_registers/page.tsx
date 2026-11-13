import type { Metadata } from "next";
import { ExecutionRegistersPage } from "@gmd/execution-registers/ui";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Execution Registers | GMD One Person Lead Framework",
};

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default function Page() {
  return <ExecutionRegistersPage actions={{ ...actions }} />;
}
