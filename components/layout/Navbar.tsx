import React from "react";
import { Bell } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background px-6 py-3">
      <div className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.jpg"
              alt="Dalui Logo"
              className="h-8 w-auto rounded object-contain bg-background p-0.5"
            />
         
          </div>
          <Link href="/" className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            Quotation Process
          </Link>
          
          <Link
            href="/raw_material"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            Raw Material
          </Link>
          <Link
            href="/supply_history"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            Supply History
          </Link>
          <Link
            href="/contract_review"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            Contract Review
          </Link>
          <Link
            href="/bom"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            BOM
          </Link>
          <Link
            href="http://192.168.1.190:6001/" target="_blank"
            className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md"
          >
            GEM BID & RA
          </Link>
          <Link
            href="/admin/lookup-options"
            className="inline-flex h-9 items-center gap-1.5 bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800 rounded-md"
          >
            Admin
          </Link>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <button className="relative p-1 text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5 stroke-[1.75]" />
              <span className="absolute top-1 right-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
}
