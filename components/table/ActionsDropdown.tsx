"use client";

import React, { useState } from "react";
import { MoreVertical, Eye, Edit2, Trash2, FileText } from "lucide-react";
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
import { PARTY_NAMES } from "@/lib/partyNames";

interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string | null;
  size: number | null;
}

interface DropdownOptions {
  enquiryTypes: string[];
  states: string[];
  paymentTerms: string[];
  inspections: string[];
  pbgs: string[];
  utilities: string[];
  vaPercents: string[];
  orderStatuses: string[];
  itemTypes: string[];
  mocs: string[];
  sizes: string[];
  pnRatings: string[];
  operationTypes: string[];
  extensions: string[];
  bypasses: string[];
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

interface ActionsDropdownProps {
  item: {
    id: string;
    itemName: string;
    quantity: any;
    itemType?: string | null;
    moc?: string | null;
    size?: string | null;
    pnRating?: string | null;
    operationType?: string | null;
    extension?: string | null;
    bypass?: string | null;
    productCost?: any | null;
    costRefCode?: string | null;
    cost?: any | null;
    stockStatus?: string | null;
    discount?: any | null;
    enquiry: {
      id: string;
      docketNumber: string;
      partyName: string;
      enquiryDate: Date;
      enquiryType: string | null;
      state: string | null;
      paymentTerms: string | null;
      inspection: string | null;
      pbg: string | null;
      utility: string | null;
      vaPercent: number | null;
      orderStatus: string | null;
      attachments: Attachment[];
    };
  };
  dropdownOptions: DropdownOptions;
}

export default function ActionsDropdown({ item, dropdownOptions }: ActionsDropdownProps) {
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
  
  // Enquiry-level metadata states
  const [enquiryType, setEnquiryType] = useState(item.enquiry.enquiryType || "");
  const [state, setState] = useState(item.enquiry.state || "");
  const [paymentTerms, setPaymentTerms] = useState(item.enquiry.paymentTerms || "");
  const [inspection, setInspection] = useState(item.enquiry.inspection || "");
  const [pbg, setPbg] = useState(item.enquiry.pbg || "");
  const [utility, setUtility] = useState(item.enquiry.utility || "");
  const [vaPercent, setVaPercent] = useState(item.enquiry.vaPercent ? `${item.enquiry.vaPercent}%` : "");
  const [orderStatus, setOrderStatus] = useState(item.enquiry.orderStatus || "");

  // Item-level specs states
  const [itemName, setItemName] = useState(item.itemName);
  const [quantity, setQuantity] = useState(item.quantity.toString());
  const [itemType, setItemType] = useState(item.itemType || "");
  const [moc, setMoc] = useState(item.moc || "");
  const [size, setSize] = useState(item.size || "");
  const [pnRating, setPnRating] = useState(item.pnRating || "");
  const [operationType, setOperationType] = useState(item.operationType || "");
  const [extension, setExtension] = useState(item.extension || "");
  const [bypass, setBypass] = useState(item.bypass || "");
  const [productCost, setProductCost] = useState(item.productCost?.toString() || "");
  const [costRefCode, setCostRefCode] = useState(item.costRefCode || "");
  const [cost, setCost] = useState(item.cost?.toString() || "");
  const [stockStatus, setStockStatus] = useState(item.stockStatus || "");
  const [discount, setDiscount] = useState(item.discount?.toString() || "");

  const [editFiles, setEditFiles] = useState<{ name: string; size: number; type: string }[]>(
    item.enquiry.attachments.map((att) => ({
      name: att.name,
      size: att.size || 0,
      type: att.type || "",
    }))
  );
  const [selectedEditFiles, setSelectedEditFiles] = useState<File[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = Array.from(e.target.files);
      setSelectedEditFiles(fileList);
      setEditFiles(fileList.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.name.split(".").pop() || "",
      })));
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    // STRICT VALIDATIONS (ALL FIELDS ARE MANDATORY ON EDIT)
    if (!docketNumber.trim()) {
      toast.error("Docket Number is required.");
      return;
    }
    if (!enquiryDate) {
      toast.error("Enquiry Date is required.");
      return;
    }
    if (!partyName.trim()) {
      toast.error("Party Name is required.");
      return;
    }
    if (!enquiryType) {
      toast.error("Enquiry Type is required.");
      return;
    }
    if (!state) {
      toast.error("State is required.");
      return;
    }
    if (!paymentTerms) {
      toast.error("Payment Terms is required.");
      return;
    }
    if (!inspection) {
      toast.error("Inspection is required.");
      return;
    }
    if (!pbg) {
      toast.error("PBG is required.");
      return;
    }
    if (!utility) {
      toast.error("Utility is required.");
      return;
    }
    if (!vaPercent) {
      toast.error("VA% is required.");
      return;
    }
    if (!orderStatus) {
      toast.error("Order Status is required.");
      return;
    }
    if (!itemName.trim()) {
      toast.error("Item Name is required.");
      return;
    }
    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      toast.error("A valid Quantity greater than 0 is required.");
      return;
    }
    if (!itemType.trim()) {
      toast.error("Item Type is required.");
      return;
    }
    if (!moc.trim()) {
      toast.error("MOC is required.");
      return;
    }
    if (!size.trim()) {
      toast.error("Size is required.");
      return;
    }
    if (!pnRating.trim()) {
      toast.error("PN Rating is required.");
      return;
    }
    if (!operationType.trim()) {
      toast.error("Operation Type is required.");
      return;
    }
    if (!extension.trim()) {
      toast.error("Extension is required.");
      return;
    }
    if (!bypass.trim()) {
      toast.error("Bypass is required.");
      return;
    }
    if (!productCost.trim() || isNaN(Number(productCost)) || Number(productCost) < 0) {
      toast.error("A valid Product Cost is required.");
      return;
    }
    if (!costRefCode.trim()) {
      toast.error("Cost Ref Code is required.");
      return;
    }
    if (!cost.trim() || isNaN(Number(cost)) || Number(cost) < 0) {
      toast.error("A valid Cost is required.");
      return;
    }
    if (!stockStatus.trim()) {
      toast.error("Stock Status is required.");
      return;
    }
    if (!discount.trim() || isNaN(Number(discount)) || Number(discount) < 0) {
      toast.error("A valid Discount is required.");
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading("Uploading new attachments to Google Drive and updating enquiry...");
    try {
      const attachmentsPayload = selectedEditFiles.length > 0
        ? await Promise.all(
            selectedEditFiles.map(async (file) => {
              const content = await fileToBase64(file);
              return {
                name: file.name,
                size: file.size,
                type: file.type || file.name.split(".").pop() || "",
                content,
              };
            })
          )
        : undefined;

      const res = await updateEnquiryItemAction({
        itemId: item.id,
        itemName: itemName.trim(),
        quantity: parseFloat(quantity),
        docketNumber: docketNumber.trim(),
        partyName,
        enquiryDate,
        enquiryType,
        state,
        paymentTerms,
        inspection,
        pbg,
        utility,
        vaPercent: parseFloat(vaPercent.replace(/%/g, "")),
        orderStatus,
        itemType: itemType.trim(),
        moc: moc.trim(),
        size: size.trim(),
        pnRating: pnRating.trim(),
        operationType: operationType.trim(),
        extension: extension.trim(),
        bypass: bypass.trim(),
        productCost: parseFloat(productCost),
        costRefCode: costRefCode.trim(),
        cost: parseFloat(cost),
        stockStatus: stockStatus.trim(),
        discount: parseFloat(discount),
        attachments: attachmentsPayload,
      });

      if (res.success) {
        toast.success("Enquiry updated successfully.", { id: toastId });
        setIsEditOpen(false);
      } else {
        toast.error(res.error || "Failed to update enquiry.", { id: toastId });
      }
    } catch (err) {
      toast.error("An unexpected error occurred.", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const res = await deleteEnquiryItemAction(item.id);
      if (res.success) {
        toast.success("Item deleted successfully.");
        setIsDeleteOpen(false);
      } else {
        toast.error(res.error || "Failed to delete item.");
      }
    } catch (err) {
      toast.error("An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectClass = "w-full h-9 rounded border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer";
  const itemSelectClass = "w-full h-8 rounded border border-input bg-background px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer";

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer" />}>
          <span className="sr-only">Open menu</span>
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => {
              setIsViewOpen(true);
              setDropdownOpen(false);
            }}
          >
            <Eye className="mr-2 h-4 w-4 text-slate-500" />
            <span>View Details</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => {
              setIsEditOpen(true);
              setDropdownOpen(false);
            }}
          >
            <Edit2 className="mr-2 h-4 w-4 text-slate-500" />
            <span>Edit Enquiry</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-red-600 focus:text-red-600 cursor-pointer"
            onClick={() => {
              setIsDeleteOpen(true);
              setDropdownOpen(false);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Delete Item</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* VIEW DETAILS DIALOG */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Enquiry & Item Details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Docket Details Section */}
            <div className="bg-slate-50 p-3 rounded-lg border border-border space-y-2.5">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-1.5 border-b border-slate-200">
                Docket Details
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Docket Number
                  </span>
                  <span className="text-foreground font-semibold text-xs">
                    {item.enquiry.docketNumber}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Enquiry Date
                  </span>
                  <span className="text-foreground font-semibold text-xs">
                    {new Date(item.enquiry.enquiryDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Enquiry Type
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.enquiryType || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    State
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.state || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Payment Terms
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.paymentTerms || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Inspection
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.inspection || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    PBG
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.pbg || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Utility
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.utility || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    VA%
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.vaPercent ? `${item.enquiry.vaPercent}%` : "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Order Status
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.enquiry.orderStatus || "-"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Party Name
                  </span>
                  <span className="text-foreground font-semibold text-xs">
                    {item.enquiry.partyName}
                  </span>
                </div>
              </div>
            </div>

            {/* Item Details Section */}
            <div className="bg-slate-50 p-3 rounded-lg border border-border space-y-2.5">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-1.5 border-b border-slate-200">
                Item Details
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Item Name as per Party
                  </span>
                  <span className="text-slate-800 font-bold text-xs">
                    {item.itemName}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Quantity
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.quantity}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Item Type
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.itemType || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    MOC
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.moc || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Size
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.size || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    PN Rating
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.pnRating || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Operation Type
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.operationType || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Extension
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.extension || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Bypass
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.bypass || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Product Cost
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.productCost ? Number(item.productCost).toLocaleString() : "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Cost Ref Code
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.costRefCode || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Cost
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.cost ? Number(item.cost).toLocaleString() : "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Stock Status
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.stockStatus || "-"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                    Discount
                  </span>
                  <span className="text-foreground font-medium text-xs">
                    {item.discount ? `${Number(item.discount).toLocaleString()}%` : "-"}
                  </span>
                </div>
              </div>
            </div>

            {/* Attachments Section */}
            <div className="space-y-1.5">
              <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider block">
                Attachments
              </span>
              {item.enquiry.attachments && item.enquiry.attachments.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {item.enquiry.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded border border-border p-2 hover:bg-slate-50 transition-colors text-xs font-semibold text-[#0f62fe] w-full"
                    >
                      <FileText className="h-4 w-4 text-[#0f62fe] stroke-[2]" />
                      <span className="truncate flex-1">{att.name}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  No attachments uploaded.
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" size="sm" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT ENQUIRY DIALOG */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Edit Enquiry & Item
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleUpdate} className="space-y-4 py-2">
            {/* Section: Docket Details */}
            <div className="bg-slate-50/50 p-3 rounded-lg border border-border space-y-3">
              <span className="text-xs font-bold text-slate-700">Enquiry Main Information</span>
              <div className="grid grid-cols-2 gap-3">
                {/* Docket Number */}
                <div className="space-y-1">
                  <Label htmlFor="edit-docket" className="text-[10px] font-semibold text-slate-600">
                    Docket Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="edit-docket"
                    value={docketNumber}
                    onChange={(e) => setDocketNumber(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* Enquiry Date */}
                <div className="space-y-1">
                  <Label htmlFor="edit-date" className="text-[10px] font-semibold text-slate-600">
                    Enquiry Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="edit-date"
                    type="date"
                    value={enquiryDate}
                    onChange={(e) => setEnquiryDate(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* Party Name Selector */}
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="edit-party" className="text-[10px] font-semibold text-slate-600">
                    Party Name <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="edit-party"
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select party...</option>
                    {PARTY_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section: Enquiry Metadata Dropdowns */}
            <div className="bg-slate-50/50 p-3 rounded-lg border border-border space-y-3">
              <span className="text-xs font-bold text-slate-700">Enquiry Metadata Specifications</span>
              <div className="grid grid-cols-2 gap-3">
                {/* Enquiry Type */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Enquiry Type <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={enquiryType}
                    onChange={(e) => setEnquiryType(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select type...</option>
                    {dropdownOptions.enquiryTypes.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* State */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    State <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select state...</option>
                    {dropdownOptions.states.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* Payment Terms */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Payment Terms <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select payment terms...</option>
                    {dropdownOptions.paymentTerms.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* Inspection */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Inspection <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={inspection}
                    onChange={(e) => setInspection(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select inspection...</option>
                    {dropdownOptions.inspections.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* PBG */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    PBG <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={pbg}
                    onChange={(e) => setPbg(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select PBG...</option>
                    {dropdownOptions.pbgs.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* Utility */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Utility <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. Utility name..."
                    value={utility}
                    onChange={(e) => setUtility(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* VA% */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    VA% <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. 10%"
                    value={vaPercent}
                    onChange={(e) => setVaPercent(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* Order Status */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Order Status <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={orderStatus}
                    onChange={(e) => setOrderStatus(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select status...</option>
                    {dropdownOptions.orderStatuses.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* File attachments */}
            <div className="space-y-1">
              <Label htmlFor="edit-files" className="text-xs font-semibold text-foreground">
                Update Files (Replaces existing) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-files"
                type="file"
                multiple
                onChange={handleFileChange}
                className="cursor-pointer text-xs"
              />
              <div className="mt-1 text-[10px] text-muted-foreground max-h-16 overflow-y-auto">
                {editFiles.length > 0 ? (
                  <span>Selected: {editFiles.map((f) => f.name).join(", ")}</span>
                ) : (
                  <span className="text-red-500 font-semibold">* At least one attachment file is required.</span>
                )}
              </div>
            </div>

            {/* Item Details Fields card grid */}
            <div className="p-3 border border-border rounded-lg bg-slate-50/50 space-y-3">
              <span className="text-xs font-bold text-slate-700">Item Specifications</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Item Name as per Party <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Quantity <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Item Type <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select type...</option>
                    {dropdownOptions.itemTypes.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    MOC <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={moc}
                    onChange={(e) => setMoc(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select MOC...</option>
                    {dropdownOptions.mocs.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Size <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select size...</option>
                    {dropdownOptions.sizes.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    PN Rating <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={pnRating}
                    onChange={(e) => setPnRating(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select rating...</option>
                    {dropdownOptions.pnRatings.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Operation Type <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={operationType}
                    onChange={(e) => setOperationType(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select operation...</option>
                    {dropdownOptions.operationTypes.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Extension <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={extension}
                    onChange={(e) => setExtension(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select extension...</option>
                    {dropdownOptions.extensions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Bypass <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={bypass}
                    onChange={(e) => setBypass(e.target.value)}
                    className={itemSelectClass}
                  >
                    <option value="">Select bypass...</option>
                    {dropdownOptions.bypasses.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Product Cost <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={productCost}
                    onChange={(e) => setProductCost(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Cost Ref Code <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    value={costRefCode}
                    onChange={(e) => setCostRefCode(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Cost <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Stock Status <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    value={stockStatus}
                    onChange={(e) => setStockStatus(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-slate-600">
                    Discount (%) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <DialogClose render={<Button type="button" variant="outline" size="sm" />}>
                Cancel
              </DialogClose>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM DIALOG */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Confirm Delete Item
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-bold text-foreground">"{item.itemName}"</span>? 
            <p className="mt-2 text-xs text-red-500 font-semibold">
              Warning: If this is the last item on the docket, the entire enquiry record will be deleted. This action cannot be undone.
            </p>
          </div>

          <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={isSubmitting} />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isSubmitting}
              onClick={handleDelete}
            >
              {isSubmitting ? "Deleting..." : "Delete Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
