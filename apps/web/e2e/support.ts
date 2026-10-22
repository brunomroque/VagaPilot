import { execSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

/** Shared e2e helpers. Data is FICTITIOUS; the dev session is the seed user Marina. */

export const MARINA_ID = "11111111-1111-4111-8111-111111111111"

export const screenshotDir =
  process.env.E2E_SCREENSHOT_DIR ?? join("test-results", "screenshots")
mkdirSync(screenshotDir, { recursive: true })

type AdminEnv = { url: string; serviceRoleKey: string }

function resolveAdminEnv(): AdminEnv | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && serviceRoleKey) return { url, serviceRoleKey }
  try {
    const raw = execSync("supabase status -o json", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      encoding: "utf8",
    })
    const status = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<
      string,
      string | undefined
    >
    const key = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
    return status.API_URL && key
      ? { url: status.API_URL, serviceRoleKey: key }
      : null
  } catch {
    return null
  }
}

/** service_role client for test setup and cleanup only (never used by the app). */
export async function adminClient(): Promise<SupabaseClient | null> {
  const env = resolveAdminEnv()
  if (!env) return null
  try {
    const health = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.serviceRoleKey },
      signal: AbortSignal.timeout(3_000),
    })
    if (!health.ok) return null
  } catch {
    return null
  }
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function signInAsDevUser(page: Page, next = "/app") {
  const response = await page.goto(
    `/dev/entrar?next=${encodeURIComponent(next)}`
  )
  test.skip(
    response?.status() === 404,
    "Dev auth bypass disabled (set VAGAPILOT_DEV_AUTH_BYPASS=1)."
  )
  await expect(page).toHaveURL(new RegExp(`${next.replace("/", "\\/")}$`))
  await expect(
    page.getByRole("heading", { level: 1, name: /Olá, Marina/ })
  ).toBeVisible()
}

/** Waits for enter/exit animations so screenshots are stable. */
export async function settle(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      )
    )
}
