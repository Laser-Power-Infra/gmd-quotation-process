"use client"

import { useActionState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { authenticate } from "@/actions/auth"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { LogIn } from "lucide-react"

export default function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || "/"

  const [state, formAction, pending] = useActionState(authenticate, undefined)

  useEffect(() => {
    if (state?.ok) {
      window.location.href = state.url
    }
  }, [state])

  const accessDenied = searchParams.get("error") === "AccessDenied"
  const signupSuccess = searchParams.get("signup") === "success"

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold text-brand">G M DALUI</h1>
        <p className="mt-1 text-sm text-muted-foreground">Executive Dashboard</p>
      </div>

      {signupSuccess && (
        <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Account created successfully. Please sign in.
        </div>
      )}

      {accessDenied && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          This Google account has no access. Ask an admin to add your email, then try again.
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={callbackUrl} />
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            placeholder="Enter your password"
          />
        </div>

        {state && !state.ok && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.message}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            "Signing in..."
          ) : (
            <>
              <LogIn size={16} />
              Sign In
            </>
          )}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            className="flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Continue with Google
          </button>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/auth/signup" className="font-semibold text-brand hover:underline">
          Sign Up
        </Link>
      </p>
    </div>
  )
}
