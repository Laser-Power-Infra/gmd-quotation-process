import type { Viewport } from "next";
import { HeatEntryForm } from "./HeatEntryForm";

export const metadata = { title: "Heat Entry" };
// cover: makes env(safe-area-inset-bottom) non-zero on notched phones.
export const viewport: Viewport = { viewportFit: "cover" };

export default function Page() {
  return <HeatEntryForm />;
}
