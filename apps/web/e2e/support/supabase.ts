import { execSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, type Locator, type Page } from "@playwright/test"

/** Local Supabase admin access for e2e setup and assertions. Never fakes a session. */
export type AdminEnv = { url: string; serviceRoleKey: string }

export function resolveAdminEnv(): AdminEnv | null {
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

export async function reachable(env: AdminEnv | null): Promise<boolean> {
  if (!env) return false
  try {
    const response = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.serviceRoleKey },
      signal: AbortSignal.timeout(3_000),
    })
    return response.ok
  } catch {
    return false
  }
}

export function adminClient(env: AdminEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const FICTITIOUS_PASSWORD = "Ficticia#2026"

/** Creates a confirmed FICTITIOUS user and returns its id and e-mail. */
export async function createFictitiousUser(
  admin: SupabaseClient,
  displayName: string
): Promise<{ id: string; email: string }> {
  const email = `e2e+${randomUUID().slice(0, 8)}@vagapilot.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: FICTITIOUS_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })
  if (error || !data.user)
    throw new Error(`createUser failed: ${error?.message}`)
  return { id: data.user.id, email }
}

function textContainerForAcceptButton(acceptButton: Locator): Locator {
  return acceptButton.locator(
    'xpath=ancestor::div[contains(@class,"rounded-md")][1]//div[starts-with(@aria-label,"Texto completo:")]'
  )
}

async function scrollTextContainerToEnd(container: Locator) {
  await container.evaluate((el) => {
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = maxTop
  })
  await container.dispatchEvent("scroll")
}

/** Scroll-to-end + per-document clickwrap on /aceite (LegalAcceptanceCard). */
export async function acceptSignupLegalDocuments(page: Page) {
  const deadline = Date.now() + 120_000

  while (new URL(page.url()).pathname === "/aceite") {
    if (Date.now() > deadline) {
      throw new Error("acceptSignupLegalDocuments timed out on /aceite")
    }

    const acceptButton = page
      .getByRole("button", { name: "Li e aceito" })
      .first()
    if (!(await acceptButton.isVisible())) break

    const fieldset = acceptButton.locator("xpath=ancestor::fieldset[1]")
    const textContainer = textContainerForAcceptButton(acceptButton)

    const enableDeadline = Date.now() + 20_000
    while (Date.now() < enableDeadline) {
      if (!(await fieldset.isDisabled())) break
      await scrollTextContainerToEnd(textContainer)
      await page.waitForTimeout(100)
    }
    await expect(fieldset).toBeEnabled({ timeout: 5_000 })

    const boxes = fieldset.locator('input[type="checkbox"]')
    for (let i = 0; i < (await boxes.count()); i++) {
      await boxes.nth(i).check()
    }

    await expect(acceptButton).toBeEnabled({ timeout: 5_000 })
    await acceptButton.click()
    await page.waitForLoadState("load", { timeout: 60_000 })
  }

  await expect(page).toHaveURL(/\/app\/onboarding$/, { timeout: 60_000 })
}

/** Logs in through the real form and accepts the terms; ends on the onboarding wizard. */
export async function signInAndAccept(page: Page, email: string) {
  await page.goto("/entrar")
  await page.getByLabel("E-mail").fill(email)
  await page.getByLabel("Senha").fill(FICTITIOUS_PASSWORD)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(/\/aceite$/)
  await acceptSignupLegalDocuments(page)
}
