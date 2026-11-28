"use client"
import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@gmd/ui/components/button"
import { Input } from "@gmd/ui/components/input"
import { Label } from "@gmd/ui/components/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gmd/ui/components/card"
import Link from "next/link"
import { toast } from "sonner"

export default function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || "/"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const accessDenied = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("error") === "AccessDenied"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await signIn("credentials", { email, password, redirect: false })
    setLoading(false)
    if (res?.error) {
      toast.error("Invalid email or password")
      return
    }
    toast.success("Logged in successfully")
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>Sign in to access admin features (APM). Rest of app works without login.</CardDescription>
        </CardHeader>
        <CardContent>
          {accessDenied && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              This Google account has no access. Ask an admin to add your email, then try again.
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button>
            {googleEnabled && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
                <Button type="button" variant="outline" className="w-full" onClick={() => signIn("google", { callbackUrl: callbackUrl })}>Continue with Google</Button>
              </>
            )}
            <p className="text-center text-xs text-muted-foreground">
              No account? <Link href="/register" className="underline text-blue-600 dark:text-blue-300">Register</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
