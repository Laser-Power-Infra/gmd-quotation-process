import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcrypt"
import { z } from "zod"
import { emailSchema } from "@/lib/email"
import Google from "next-auth/providers/google"


// Google sign-in is an allowlist: the account must already exist in User and be active.
const googleEnabled = !!process.env.AUTH_GOOGLE_ID_QUOTATION
const RECHECK_MS = 5 * 60 * 1000

async function findAllowedUser(email: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } },
    select: { id: true, role: true, active: true },
  })
  return user && user.active ? user : null
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [ 
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = z
          .object({
            email: emailSchema,
            password: z.string().min(1),
          })
          .safeParse(credentials)
        if (!parsed.success) return null
        const { email, password } = parsed.data
        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.password || !user.active) return null
        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        } as any
      },
    }),
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID_QUOTATION, clientSecret: process.env.AUTH_GOOGLE_SECRET_QUOTATION })] : []),
  ],
  // No "secure" here: Auth.js sets it from the protocol, so the cookie survives on the plain-HTTP LAN server.
  cookies: {
    sessionToken: { name: "gmd-quotation.session-token", options: { httpOnly: true, sameSite: "lax", path: "/" } },
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true
      if (!profile?.email || profile.email_verified !== true) return false
      return !!(await findAllowedUser(profile.email))
    },
    async jwt({ token, user, account, profile }) {
      const t = token as any
      if (account?.provider === "google" && profile?.email) {
        // The Google profile id is not our User id: take id and role from the DB row.
        const dbUser = await findAllowedUser(profile.email)
        if (!dbUser) return null
        t.id = dbUser.id
        t.role = dbUser.role
        t.checkedAt = Date.now()
      } else if (user) {
        t.role = (user as any).role
        t.id = (user as any).id
        t.checkedAt = Date.now()
      } else if (t.id && Date.now() - (t.checkedAt ?? 0) > RECHECK_MS) {
        // Ends the session of a user who was deactivated, and picks up role changes.
        const dbUser = await prisma.user.findUnique({ where: { id: t.id }, select: { role: true, active: true } })
        if (!dbUser || !dbUser.active) return null
        t.role = dbUser.role
        t.checkedAt = Date.now()
      }
      return token
    },
    session({ session, token }) {
      if (token) {
        ;(session.user as any).role = (token as any).role
        ;(session.user as any).id = (token as any).sub ?? (token as any).id
      }
      return session
    },
    // Keep app public — do not require auth globally. APM + OfferPDF gating is per-action.
    authorized: async () => true,
  },
  pages: {
    signIn: "/login",
  },
})
