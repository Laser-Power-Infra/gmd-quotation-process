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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addItemsAction } from "@/app/actions";

interface AddItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enquiries: { id: string; docketNumber: string; partyName: string }[];
}

export default function AddItemsDialog({
  open,
  onOpenChange,
  enquiries,
}: AddItemsDialogProps) {
  const [enquiryId, setEnquiryId] = useState("");
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
    if (!enquiryId) {
      toast.error("Please select a Docket Number.");
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
      const formattedItems = items.map((item) => ({
        itemName: item.itemName.trim(),
        quantity: parseFloat(item.quantity),
      }));

      const res = await addItemsAction({ enquiryId, items: formattedItems });
      if (res.success) {
        toast.success("Items added successfully!");
        setEnquiryId("");
        setItems([{ itemName: "", quantity: "" }]);
        onOpenChange(false);
      } else {
        toast.error(res.error || "Failed to add items.");
      }
    } catch (err) {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-popover p-6 rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Add Items to Docket
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="enquirySelect" className="text-sm font-semibold text-foreground">
              Select Docket Number
            </Label>
            <Select value={enquiryId} onValueChange={(val) => setEnquiryId(val || "")}>
              <SelectTrigger id="enquirySelect" className="w-full">
                <SelectValue placeholder="Choose a docket..." />
              </SelectTrigger>
              <SelectContent>
                {enquiries.map((enq) => (
                  <SelectItem key={enq.id} value={enq.id} className="text-sm">
                    {enq.docketNumber} - {enq.partyName.split(",")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-foreground">Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItemRow}
              >
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Item Name as per Party
                    </Label>
                    <Input
                      type="text"
                      placeholder="e.g. Steel Beam"
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
                      placeholder="e.g. 500"
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
              {isSubmitting ? "Adding..." : "Add Items"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
