import { auth } from "@/auth"

export async function getCurrentUser() {
  const session = await auth()
  return session?.user ?? null
}

/** Admin or developer: may fill blank-only columns and revert entries. */
export async function isPrivileged() {
  const user = await getCurrentUser()
  return ["admin", "developer"].includes(user?.role ?? "")
}
