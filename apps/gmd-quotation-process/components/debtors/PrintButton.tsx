"use client";

export default function PrintButton() {
  return <button type="button" className="rounded border px-3 py-1 text-sm print:hidden" onClick={() => window.print()}>Print / Save as PDF</button>;
}
