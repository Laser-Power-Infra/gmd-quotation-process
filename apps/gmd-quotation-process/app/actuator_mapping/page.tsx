import type { Metadata } from "next";
import { ActuatorMappingPage } from "@gmd/actuator-mapping/ui";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Actuator & Gearbox Mapping | GMD Quotation Process",
  description: "Valve type, size and pressure mapped to gearbox and actuator, with live stock.",
};

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default function Page() {
  return <ActuatorMappingPage actions={{ ...actions }} />;
}
