"use client"
import { signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const handleLogout = async () => {
    setLoading(true)
    try {
      // No redirect, stay on same page — just clear JWT cookie via /api/auth/signout
      await signOut({ redirect: false })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleLogout} disabled={loading}>
      {loading ? "..." : "Logout"}
    </Button>
  )
}
