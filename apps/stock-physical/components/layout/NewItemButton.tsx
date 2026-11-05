"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import NewItemDialog from "@gmd/physical-stock/new-item-dialog";
import { create, loadCodeOptions, loadFacet, revertEntry } from "@/app/actions";

export function NewItemButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300 transition-all"
      >
        <Plus size={12} />
        New
      </button>
      <NewItemDialog
        open={open}
        onOpenChange={setOpen}
        loadFacet={loadFacet}
        loadCodeOptions={loadCodeOptions}
        create={create}
        revertEntry={revertEntry}
        onCreated={() => window.dispatchEvent(new Event("physical-stock:created"))}
      />
    </>
  );
}
