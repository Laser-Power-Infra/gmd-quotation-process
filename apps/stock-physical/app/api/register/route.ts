import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcrypt"
import { z } from "zod"
import { ALLOWED_EMAIL_DOMAINS, PENDING_ROLE, isAllowedEmailDomain } from "@/lib/registration"

const schema = z.object({
  name: z.string().optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 })
    }
    const { name, email, password } = parsed.data
    if (!isAllowedEmailDomain(email)) {
      return NextResponse.json(
        { error: `Registration is limited to ${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(" / ")} emails` },
        { status: 403 },
      )
    }
    // Case-insensitive so older mixed-case rows still count as duplicates.
    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 })
    const hash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({ data: { name: name || null, email, password: hash, role: PENDING_ROLE } })
    return NextResponse.json({ success: true, id: user.id, pendingApproval: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Registration failed" }, { status: 500 })
  }
}
