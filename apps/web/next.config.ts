import { resolve } from "node:path"

import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

import { securityHeaders } from "./lib/security/csp"

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")

const isDev = process.env.NODE_ENV !== "production"

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders(isDev) }]
  },
  transpilePackages: [
    "@workspace/ui",
    "@vagapilot/core",
    "@vagapilot/db",
    "@vagapilot/ai",
    "@vagapilot/jobs",
    "@vagapilot/gmail",
    "@vagapilot/ats-adapters",
    "@vagapilot/browser-pool",
  ],
  experimental: {
    // CV uploads are up to 10 MB (spec 10.4) plus multipart overhead; proxy.ts buffers the body.
    proxyClientMaxBodySize: "12mb",
  },
  devIndicators: { position: "bottom-right" },
  // Playwright and the local Supabase redirects use 127.0.0.1 instead of localhost.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.ts": {
        condition: {
          path: /(packages|@vagapilot)\/(core|db|ai|jobs|gmail|ats-adapters|browser-pool)\/src\//,
        },
        loaders: [resolve("turbopack/strip-relative-js-extension.cjs")],
        as: "*.ts",
      },
    },
  },
}

export default withNextIntl(nextConfig)
