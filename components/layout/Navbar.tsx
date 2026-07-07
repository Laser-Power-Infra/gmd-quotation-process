import React from "react";
import { Bell, Search } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background px-6 py-3">
      <div className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[#0f62fe] text-white">
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M4 19h4c.55 0 1-.45 1-1v-5c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1zm6-6h4c.55 0 1-.45 1-1V7c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1zm6-10h4c.55 0 1-.45 1-1v-5c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1z" />
              </svg>
            </div>
            <span className="text-base font-bold tracking-tight text-foreground">
              GMD Quotation Process
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative w-64">
            <Search className="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Global search..."
              className="w-full rounded-full border border-border bg-muted py-1.5 pr-4 pl-9 text-xs text-foreground placeholder-muted-foreground outline-none transition focus:border-slate-300"
            />
          </div>

          <div className="flex items-center gap-4">
            <button className="relative p-1 text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5 stroke-[1.75]" />
              <span className="absolute top-1 right-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            </button>

            <ThemeToggle />
          </div>

        </div>
      </div>
    </header>
  );
}
