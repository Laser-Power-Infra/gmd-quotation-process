"use client";

import React, { useState } from "react";
import { MoreVertical, Eye, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { updateEnquiryItemAction, deleteEnquiryItemAction } from "@/app/actions";

interface ActionsDropdownProps {
  item: {
    id: string;
    itemName: string;
    quantity: any;
    enquiry: {
      id: string;
      docketNumber: string;
      partyName: string;
      enquiryDate: Date;
      attachmentName: string | null;
      attachmentUrl: string | null;
    };
  };
}

export default function ActionsDropdown({ item }: ActionsDropdownProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Edit form state
  const [docketNumber, setDocketNumber] = useState(item.enquiry.docketNumber);
  const [partyName, setPartyName] = useState(item.enquiry.partyName);
  const [enquiryDate, setEnquiryDate] = useState(
    new Date(item.enquiry.enquiryDate).toISOString().split("T")[0]
  );
  const [itemName, setItemName] = useState(item.itemName);
  const [quantity, setQuantity] = useState(item.quantity.toString());
  const [attachmentName, setAttachmentName] = useState(item.enquiry.attachmentName || "");

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!docketNumber.trim() || !partyName.trim() || !itemName.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    const qtyNum = parseFloat(quantity);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error("Quantity must be a valid number greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updateEnquiryItemAction({
        itemId: item.id,
        itemName: itemName.trim(),
        quantity: qtyNum,
        docketNumber: docketNumber.trim(),
        partyName: partyName.trim(),
        enquiryDate,
        attachmentName: attachmentName.trim() || undefined,
      });

      if (res.success) {
        toast.success("Enquiry item updated successfully!");
        setIsEditOpen(false);
      } else {
        toast.error(res.error || "Failed to update item.");
      }
    } catch (err) {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const res = await deleteEnquiryItemAction(item.id);
      if (res.success) {
        toast.success("Item deleted successfully!");
        setIsDeleteOpen(false);
      } else {
        toast.error(res.error || "Failed to delete item.");
      }
    } catch (err) {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center hover:bg-muted rounded-full cursor-pointer outline-none select-none text-muted-foreground">
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover border-border w-32">
          <DropdownMenuItem
            onClick={() => setIsViewOpen(true)}
            className="flex items-center gap-2 text-sm text-foreground hover:bg-muted cursor-pointer"
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
            View
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setIsEditOpen(true)}
            className="flex items-center gap-2 text-sm text-foreground hover:bg-muted cursor-pointer"
          >
            <Edit2 className="h-4 w-4 text-muted-foreground" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setIsDeleteOpen(true)}
            className="flex items-center gap-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-md bg-popover p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Enquiry Details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm text-foreground">
            <div className="grid grid-cols-2 gap-4 border-b border-border pb-3">
              <div>
                <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                  Docket Number
                </span>
                <span className="text-[#0f62fe] font-bold text-sm">
                  #{item.enquiry.docketNumber}
                </span>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                  Enquiry Date
                </span>
                <span className="text-foreground font-semibold text-sm">
                  {new Date(item.enquiry.enquiryDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            <div className="border-b border-border pb-3">
              <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                Party / Company
              </span>
              <span className="text-foreground font-semibold text-sm">
                {item.enquiry.partyName}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 border-b border-border pb-3">
              <div>
                <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                  Item Name
                </span>
                <span className="text-foreground font-semibold text-sm">
                  {item.itemName}
                </span>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                  Quantity
                </span>
                <span className="text-foreground font-semibold text-sm">
                  {Number(item.quantity).toLocaleString()}
                </span>
              </div>
            </div>

            <div>
              <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block">
                Attachment
              </span>
              {item.enquiry.attachmentName ? (
                <span className="text-foreground font-semibold text-sm">
                  {item.enquiry.attachmentName}
                </span>
              ) : (
                <span className="text-muted-foreground italic text-sm">No attachment</span>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <DialogClose className="inline-flex h-9 items-center justify-center rounded-md bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/80 cursor-pointer">
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg bg-popover p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Edit Enquiry Item
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleUpdate} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Docket Number</Label>
                <Input
                  type="text"
                  value={docketNumber}
                  onChange={(e) => setDocketNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Enquiry Date</Label>
                <Input
                  type="date"
                  value={enquiryDate}
                  onChange={(e) => setEnquiryDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-foreground">Party Name</Label>
              <Input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs font-semibold text-foreground">Item Name</Label>
                <Input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Quantity</Label>
                <Input
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-foreground">Attachment Name</Label>
              <Input
                type="text"
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
                placeholder="e.g. spec.pdf (leave empty to remove)"
              />
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
                {isSubmitting ? "Updating..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-sm bg-popover p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Delete Item?
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-sm text-foreground">
            Are you sure you want to delete the item{" "}
            <span className="font-semibold text-foreground">"{item.itemName}"</span>? This
            action cannot be undone.
          </div>

          <DialogFooter className="pt-2 gap-2">
            <DialogClose className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted cursor-pointer">
              Cancel
            </DialogClose>
            <Button
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
