import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import Google from "next-auth/providers/google"

// Google sign-in is an allowlist: the account must already exist in users and be active.
const googleEnabled = !!process.env.AUTH_GOOGLE_ID_TENDER
const RECHECK_MS = 5 * 60 * 1000

async function findAllowedUser(email: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } },
    select: { id: true, role: true, active: true },
  })
  return user && user.active ? user : null
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const { email, password } = credentials as {
          email: string
          password: string
        }

        if (!email || !password) return null

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.passwordHash || !user.active) return null

        const isValid = await bcrypt.compare(password, user.passwordHash)
        if (!isValid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      },
    }),
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID_TENDER, clientSecret: process.env.AUTH_GOOGLE_SECRET_TENDER })] : []),
  ],
  cookies: {
    sessionToken: { name: "gmd-tender.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
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
        t.id = user.id as string
        t.role = (user as any).role
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
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/login" },
  trustHost: true,
})
