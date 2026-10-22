/**
 * Dev-only fake session used by the shell smoke tests and local UI work without Supabase.
 * Active only when NODE_ENV !== "production" AND VAGAPILOT_DEV_AUTH_BYPASS=1, and only for
 * requests carrying the DEV_SESSION_COOKIE (set by GET /dev/entrar). Inert in production builds.
 */
export const DEV_SESSION_COOKIE = "vp_dev_session"

export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.VAGAPILOT_DEV_AUTH_BYPASS === "1"
  )
}

/** Fictitious seed user (supabase/seed.sql). The password is the documented seed password. */
export const devUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "marina@vagapilot.test",
  displayName: "Marina Alves",
  password: "Ficticia#2026",
} as const
