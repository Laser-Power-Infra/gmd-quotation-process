"use server";
import { requireAccess } from "@/lib/access";
import { getContractInvoices, type InvoiceLine } from "@/lib/executionPages-server";

/** Paper-trail drill-down: invoices raised against one contract. */
export async function fetchContractInvoicesAction(
  contractNo: string,
): Promise<{ success: true; invoices: InvoiceLine[] } | { success: false; error: string }> {
  try {
    await requireAccess();
    if (!contractNo?.trim()) return { success: false, error: "Contract number is required." };
    return { success: true, invoices: await getContractInvoices(contractNo) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load invoices" };
  }
}
