import { defineConfig, devices } from "@playwright/test"

const desktopChrome = devices["Desktop Chrome"]

if (!desktopChrome) {
  throw new Error("Playwright device Desktop Chrome is not available")
}

// Dedicated port so a stray dev server on :3000 is never reused by mistake.
const port = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The dev server compiles routes on first hit; keep parallelism and timeouts dev-friendly.
  workers: process.env.CI ? 1 : 2,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...desktopChrome, viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Dev-only fake session for the shell smoke (see lib/auth/dev-bypass.ts). Inert in production.
      VAGAPILOT_DEV_AUTH_BYPASS: "1",
      // Job links are served from FICTITIOUS recorded fixtures (packages/ats-adapters/fixtures), never the network.
      VAGAPILOT_ATS_FIXTURES: "1",
      // Fixture Gmail backend for the P4 e2e (packages/gmail/src/mock.ts). Never in production.
      VAGAPILOT_GMAIL_MOCK: "1",
    },
  },
})
