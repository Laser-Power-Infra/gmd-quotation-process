"use client";

import { useState, useRef, useMemo } from "react";
import { Upload, ExternalLink, ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { uploadImageForComboAction, createGeneratedImageAction } from "@/app/actions";
import { RM_TYPE_OPTIONS } from "@/lib/gmd_lib/sheet-columns";

export type UploadImageComboRow = {
  itemType: string;
  operationType: string;
  rmType: string;
  imageKey: string;
  generatedImageId: string | null;
  url: string | null;
  driveFileId: string | null;
  status: string;
  error: string | null;
  generatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  hasImage: boolean;
  rmTypeBlank: boolean;
};

// Keep legacy type for backwards compat if needed
export type GeneratedImageRow = UploadImageComboRow;

function StatusBadge({ status, hasImage }: { status: string; hasImage: boolean }) {
  const normalized = hasImage ? "ready" : (status || "pending").toLowerCase();
  const cls =
    normalized === "ready"
      ? "bg-green-50 text-green-700 border-green-200"
      : normalized === "failed"
      ? "bg-red-50 text-red-700 border-red-200"
      : normalized === "generating"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-slate-50 text-slate-600 border-slate-200";
  const label = hasImage ? "ready" : status || "pending";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

export default function UploadImageTable({
  items,
  onUploaded,
}: {
  items: UploadImageComboRow[];
  onUploaded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeRow, setActiveRow] = useState<UploadImageComboRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      [r.itemType, r.operationType, r.rmType, r.status, r.imageKey, r.driveFileId]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  const handlePick = (row: UploadImageComboRow) => {
    setActiveRow(row);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleRmTypeSelect = async (row: UploadImageComboRow, value: string) => {
    const rmType = value.trim();
    if (!rmType) return;
    setAssigningKey(row.imageKey);
    const toastId = toast.loading("Assigning RM Type...");
    try {
      const res: any = await createGeneratedImageAction({
        itemType: row.itemType,
        operationType: row.operationType,
        rmType,
      });
      if (res?.success === false) {
        toast.error(res.error || "Failed to assign RM Type", { id: toastId });
        return;
      }
      toast.success(`RM Type "${rmType}" assigned`, { id: toastId });
      onUploaded();
    } catch (err: any) {
      toast.error(err?.message || "Failed to assign RM Type", { id: toastId });
    } finally {
      setAssigningKey(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const row = activeRow;
    if (!file || !row) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("File too large (max 10 MB).");
      return;
    }
    setUploadingKey(row.imageKey);
    const toastId = toast.loading("Uploading to Drive...");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const res: any = await uploadImageForComboAction({
        itemType: row.itemType,
        operationType: row.operationType,
        rmType: row.rmType,
        fileName: file.name,
        mimeType: file.type || "image/png",
        base64Data: base64,
      });
      if (res?.success === false) {
        toast.error(res.error || "Upload failed", { id: toastId });
        return;
      }
      toast.success("Image uploaded to Drive", { id: toastId });
      onUploaded();
    } catch (err: any) {
      toast.error(err?.message || "Upload failed", { id: toastId });
    } finally {
      setUploadingKey(null);
      setActiveRow(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col w-full bg-white border border-[#e1e6eb] rounded-lg shadow-sm overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e1e6eb] bg-[#f8f9fa] gap-2">
        <span className="text-xs font-semibold text-[#0a2540]/60">
          Showing {filtered.length} of {items.length} records · {items.filter((i) => i.hasImage).length} with image · {items.filter((i) => !i.hasImage).length} pending
        </span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0a2540]/40" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search itemType / operationType / rmType..."
              className="w-64 pl-8 pr-7 py-1.5 text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] outline-none focus:border-[#0070f3] placeholder:text-[#0a2540]/30"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="w-full overflow-auto" style={{ maxHeight: "62vh" }}>
        <table className="w-full text-left" style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 210 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#f4f6f8]">
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">Item Type</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">Operation Type</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">RM Type</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">Status</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb] border-r">Image</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#0a2540] border-b-2 border-[#e1e6eb]">Upload</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={6} className="h-24 text-center text-xs text-muted-foreground">
                  No matching rows — no distinct itemType/operationType combos found in enquiry items.
                </td>
              </tr>
            ) : (
              paged.map((row) => {
                const hasImage = row.hasImage;
                const thumbnailUrl = row.driveFileId
                  ? `https://drive.google.com/thumbnail?id=${row.driveFileId}&sz=w400`
                  : null;
                const isUploading = uploadingKey === row.imageKey;
                const isAssigning = assigningKey === row.imageKey;
                const isBlank = row.rmTypeBlank;
                return (
                  <tr key={row.imageKey} className="hover:bg-gray-50 transition-colors border-b border-[#e1e6eb] last:border-b-0">
                    <td className="px-3 py-2 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate" title={row.itemType}>
                      {row.itemType || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#0a2540] border-r border-[#e1e6eb] truncate" title={row.operationType}>
                      {row.operationType || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-3 py-1 text-xs text-[#0a2540] border-r border-[#e1e6eb]" title={row.rmType}>
                      {isBlank ? (
                        <div className="relative">
                          <select
                            value=""
                            disabled={isAssigning}
                            onChange={(e) => handleRmTypeSelect(row, e.target.value)}
                            className="w-full bg-white border border-[#d0d7de] rounded px-2 py-1 pr-6 text-xs text-[#0a2540] outline-none focus:border-[#0f62fe] focus:ring-1 focus:ring-[#0f62fe]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="">Select RM Type</option>
                            {RM_TYPE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {isAssigning && (
                            <Loader2 size={12} className="animate-spin absolute right-1.5 top-1/2 -translate-y-1/2 text-[#0a2540]/50 pointer-events-none" />
                          )}
                        </div>
                      ) : (
                        <span className="truncate block" title={row.rmType}>
                          {row.rmType || <span className="text-gray-400 italic">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-[#e1e6eb]">
                      <StatusBadge status={row.status} hasImage={hasImage} />
                    </td>
                    <td className="px-3 py-2 border-r border-[#e1e6eb]">
                      {hasImage ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-14 h-14 rounded border border-[#e1e6eb] bg-[#f8f9fa] overflow-hidden flex items-center justify-center shrink-0">
                            {thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumbnailUrl}
                                alt={row.imageKey}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <ImageIcon size={16} className="text-[#0a2540]/30" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 gap-0.5">
                            {row.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline truncate"
                                title={row.url}
                                onClick={(e) => e.stopPropagation()}
                              >
                                View <ExternalLink size={10} />
                              </a>
                            ) : null}
                            {row.driveFileId ? (
                              <span className="text-[10px] text-muted-foreground truncate" title={row.driveFileId}>
                                {row.driveFileId.slice(0, 18)}…
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <ImageIcon size={14} /> No image
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isBlank ? (
                        <span className="text-[11px] text-gray-400 italic" title="Select an RM Type first to enable upload">
                          Select RM Type first
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          className="h-7 gap-1.5 px-2.5 text-[11px] font-semibold border-[#0f62fe]/20 bg-white hover:bg-[#f0f4ff] text-[#0f62fe]"
                          onClick={() => handlePick(row)}
                          disabled={isUploading}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 size={12} className="animate-spin" /> Uploading...
                            </>
                          ) : (
                            <>
                              <Upload size={12} /> {hasImage ? "Replace" : "Upload Image"}
                            </>
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-[#e1e6eb] bg-[#f8f9fa]">
        <span className="text-xs text-[#0a2540]/60">
          Page {currentPage} of {totalPages} · {filtered.length} rows
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <span className="text-xs font-medium text-[#0a2540]">{currentPage} / {totalPages}</span>
          <Button
            variant="outline"
            size="xs"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
