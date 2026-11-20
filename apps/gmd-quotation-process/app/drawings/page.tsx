import type { Metadata } from "next";
import { getDrawingRights } from "./actions";
import { DrawingsView } from "./drawings-view";

export const metadata: Metadata = { title: "Drawings | GMD One Person Lead Framework" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // Only hides controls; every action checks the caller's role again.
  const rights = await getDrawingRights();
  return <DrawingsView rights={rights.success ? rights.data : { role: "viewer" }} />;
}
