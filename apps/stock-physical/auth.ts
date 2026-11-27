import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcrypt"
import { z } from "zod"
import { PENDING_ROLE } from "@/lib/registration"
import Google from "next-auth/providers/google"

class PendingApproval extends CredentialsSignin {
  code = "pending_approval"
}


// Google sign-in is an allowlist: the account must already exist in User and be active.
const googleEnabled = !!process.env.AUTH_GOOGLE_ID
const RECHECK_MS = 5 * 60 * 1000

async function findAllowedUser(email: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } },
    select: { id: true, role: true, active: true },
  })
  return user && user.active && user.role !== PENDING_ROLE ? user : null
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
            email: z.string().trim().toLowerCase().email(),
            password: z.string().min(1),
          })
          .safeParse(credentials)
        if (!parsed.success) return null
        const { email, password } = parsed.data
        // Case-insensitive so accounts stored before lower-casing can still sign in.
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })
        if (!user || !user.password || !user.active) return null
        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null
        if (user.role === PENDING_ROLE) throw new PendingApproval()
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        } as any
      },
    }),
    ...(googleEnabled ? [Google] : []),
  ],
  cookies: {
    sessionToken: { name: "gmd-stock.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
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
    // Gating is done in proxy.ts; keep the callback permissive.
    authorized: async () => true,
  },
  pages: {
    signIn: "/login",
  },
})
