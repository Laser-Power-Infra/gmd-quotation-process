"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@gmd/ui/components/button"
import { Input } from "@gmd/ui/components/input"
import { Label } from "@gmd/ui/components/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gmd/ui/components/card"
import Link from "next/link"
import { toast } from "sonner"
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/registration"

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Registration failed")
        return
      }
      toast.success("Registered — an admin must approve your account before you can log in")
      router.push("/login")
    } catch (err: any) {
      toast.error(err.message || "Registration failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Company emails only ({ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(", ")}). New accounts need admin approval before login.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} required autoComplete="email" autoCapitalize="none" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password (min 6)</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating..." : "Create account"}</Button>
            <p className="text-center text-xs text-muted-foreground">
              Have account? <Link href="/login" className="underline text-blue-600 dark:text-blue-300">Login</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
