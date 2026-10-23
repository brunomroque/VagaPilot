/** PostHog lazy-loads SDK bundles and config from subdomains of posthog.com (see PostHog CSP docs). */
const POSTHOG_ORIGIN = "https://*.posthog.com"

/** Content-Security-Policy for the web app (spec 12, OWASP ASVS). */
export function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptParts = ["'self'", "'unsafe-inline'", POSTHOG_ORIGIN]
  if (isDev) scriptParts.splice(2, 0, "'unsafe-eval'")
  const scriptSrc = `script-src ${scriptParts.join(" ")}`
  const connect = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    POSTHOG_ORIGIN,
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
