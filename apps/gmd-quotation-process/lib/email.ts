import { z } from "zod"

// Shared by register and login so both store and look up the same normalized form.
export const emailSchema = z.string().trim().toLowerCase().max(254).email("Enter a valid email")
