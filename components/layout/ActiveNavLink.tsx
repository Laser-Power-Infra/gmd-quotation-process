"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const IDLE =
  "bg-[#0353e9] hover:bg-[#034ad0] text-white dark:bg-blue-700 dark:hover:bg-blue-800";
const ACTIVE = "bg-[#0a2540] text-white hover:bg-[#0a2540]";

type ActiveNavLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
};

export default function ActiveNavLink({ href, children, className }: ActiveNavLinkProps) {
  const pathname = usePathname();
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 px-4 text-sm font-semibold rounded-md",
        active ? ACTIVE : IDLE,
        className
      )}
    >
      {children}
    </Link>
  );
}