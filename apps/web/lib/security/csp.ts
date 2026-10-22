/** Content-Security-Policy for the web app (spec 12, OWASP ASVS). */
export function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'"
  const connect = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://eu.i.posthog.com",
    "https://us.i.posthog.com",
    "https://*.sentry.io",
    "https://cloud.langfuse.com",
  ].join(" ")
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}

export const securityHeaders = (isDev: boolean) => [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy(isDev) },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
]
