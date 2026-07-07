"use client";

import React, { useState } from "react";
import { Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createNewEnquiryAction } from "@/app/actions";

interface NewEnquiryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NewEnquiryDialog({
  open,
  onOpenChange,
}: NewEnquiryDialogProps) {
  const [docketNumber, setDocketNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [enquiryDate, setEnquiryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [attachmentName, setAttachmentName] = useState("");
  const [items, setItems] = useState<{ itemName: string; quantity: string }[]>([
    { itemName: "", quantity: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddItemRow = () => {
    setItems([...items, { itemName: "", quantity: "" }]);
  };

  const handleRemoveItemRow = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (
    index: number,
    field: "itemName" | "quantity",
    value: string
  ) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (!docketNumber.trim()) {
      toast.error("Docket Number is required.");
      return;
    }
    if (!companyName.trim()) {
      toast.error("Company Name is required.");
      return;
    }
    if (!enquiryDate) {
      toast.error("Enquiry Date is required.");
      return;
    }

    // Validate items
    for (const item of items) {
      if (!item.itemName.trim()) {
        toast.error("Item Name is required for all rows.");
        return;
      }
      const qtyNum = parseFloat(item.quantity);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        toast.error("Quantity must be a valid number greater than 0.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const partyName = branchName.trim()
        ? `${companyName.trim()}, ${branchName.trim()}`
        : companyName.trim();

      const formattedItems = items.map((item) => ({
        itemName: item.itemName.trim(),
        quantity: parseFloat(item.quantity),
      }));

      const res = await createNewEnquiryAction({
        docketNumber: docketNumber.trim(),
        partyName,
        enquiryDate,
        attachmentName: attachmentName.trim() || undefined,
        items: formattedItems,
      });

      if (res.success) {
        toast.success("Enquiry created successfully!");
        // Reset form
        setDocketNumber("");
        setCompanyName("");
        setBranchName("");
        setEnquiryDate(new Date().toISOString().split("T")[0]);
        setAttachmentName("");
        setItems([{ itemName: "", quantity: "" }]);
        onOpenChange(false);
      } else {
        toast.error(res.error || "Failed to create enquiry.");
      }
    } catch (err) {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-popover p-6 rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Create New Enquiry
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="docketNumber" className="text-xs font-semibold text-foreground">
                Docket Number
              </Label>
              <Input
                id="docketNumber"
                type="text"
                placeholder="e.g. ORD-9903"
                value={docketNumber}
                onChange={(e) => setDocketNumber(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="enquiryDate" className="text-xs font-semibold text-foreground">
                Enquiry Date
              </Label>
              <Input
                id="enquiryDate"
                type="date"
                value={enquiryDate}
                onChange={(e) => setEnquiryDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="companyName" className="text-xs font-semibold text-foreground">
                Company Name
              </Label>
              <Input
                id="companyName"
                type="text"
                placeholder="e.g. Tata Industrial Ltd."
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="branchName" className="text-xs font-semibold text-foreground">
                Branch / Location (Optional)
              </Label>
              <Input
                id="branchName"
                type="text"
                placeholder="e.g. Jamshedpur Unit"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="attachmentName" className="text-xs font-semibold text-foreground">
              Attachment Name (Optional)
            </Label>
            <Input
              id="attachmentName"
              type="text"
              placeholder="e.g. specification.pdf"
              value={attachmentName}
              onChange={(e) => setAttachmentName(e.target.value)}
            />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Label className="text-sm font-semibold text-foreground">Enquiry Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItemRow}
              >
                <Plus className="h-3.5 w-3.5" /> Add Item
              </Button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-3 pr-1">
              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Item Name as per Party
                    </Label>
                    <Input
                      type="text"
                      placeholder="e.g. Structural Steel Beam"
                      value={item.itemName}
                      onChange={(e) =>
                        handleItemChange(index, "itemName", e.target.value)
                      }
                    />
                  </div>

                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">Quantity</Label>
                    <Input
                      type="number"
                      step="any"
                      placeholder="e.g. 1000"
                      value={item.quantity}
                      onChange={(e) =>
                        handleItemChange(index, "quantity", e.target.value)
                      }
                    />
                  </div>

                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItemRow(index)}
                      className="text-red-500 hover:bg-red-50 hover:text-red-600 h-9 w-9 shrink-0"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-4 gap-2">
            <DialogClose className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted cursor-pointer">
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#0f62fe] hover:bg-[#0353e9] text-white"
            >
              {isSubmitting ? "Creating..." : "Create Enquiry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
