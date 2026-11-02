import { auth } from "@/auth"
import { NextResponse } from "next/server"

export const proxy = auth((req) => {
  if (req.auth) return
  // Rewrite, not redirect: the URL stays on the requested route. Built from the
  // Host header because auth() swaps req.nextUrl's origin for NEXTAUTH_URL, and a
  // rewrite to another origin is proxied there (ETIMEDOUT in dev).
  const host = req.headers.get("host") ?? req.nextUrl.host
  return NextResponse.rewrite(new URL("/login", `${req.nextUrl.protocol}//${host}`))
})

export const config = {
  // logo.jpg must be public: the image optimizer fetches it without cookies, and the
  // login rewrite would hand it HTML instead (broken navbar logo).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|logo.jpg|login|register).*)"],
}
