import { z } from "zod"

export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(72),
})

export type Credentials = z.infer<typeof credentialsSchema>

export const consentRequestSchema = z.object({
  purposes: z.array(z.enum(["termos", "privacidade"])).min(1),
  version: z.literal("v1"),
})

export type ConsentRequest = z.infer<typeof consentRequestSchema>

export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "not_configured"
  | "google_unavailable"
  | "weak_password"
  | "rate_limited"
  | "unknown"

export type AuthActionResult =
  { error: { code: AuthErrorCode; message: string } } | undefined
