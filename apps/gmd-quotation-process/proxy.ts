import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { isRestricted } from "@/lib/access"

// Open on the local server. When restricted (Vercel) only admin/developer get past /login.
export const proxy = auth((req) => {
  if (!isRestricted()) return
  const { pathname } = req.nextUrl
  if (pathname === "/login" || pathname === "/register") return
  const role = (req.auth?.user as { role?: string } | undefined)?.role
  if (role === "admin" || role === "developer") return
  const url = new URL("/login", req.nextUrl.origin)
  url.searchParams.set("callbackUrl", pathname)
  return NextResponse.redirect(url)
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
