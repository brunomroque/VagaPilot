import { execSync } from "node:child_process"

import { createClient } from "@supabase/supabase-js"
import { expect, test } from "@playwright/test"

/*
 * P0.3 acceptance: cadastro → confirmação de e-mail → aceite de termos → /app/chat.
 * Needs the local Supabase stack (`supabase start && pnpm db:reset`) and apps/web/.env.local
 * pointing at it. Without it the test is skipped explicitly; it never fakes a session.
 */

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

async function reachable(env: AdminEnv | null): Promise<boolean> {
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

const adminEnv = resolveAdminEnv()
const supabaseUp = await reachable(adminEnv)

test.describe("auth with Supabase", () => {
  test.skip(
    !supabaseUp,
    "Local Supabase is not running (supabase start); auth e2e skipped."
  )

  test("cadastro → aceite → /app/chat", async ({ page }) => {
    if (!adminEnv) throw new Error("unreachable")
    const email = `e2e+${Date.now()}@vagapilot.test`
    const password = "Ficticia#2026"

    await page.goto("/cadastro")
    test.skip(
      await page.getByText("não está configurada neste ambiente").isVisible(),
      "apps/web/.env.local does not point at the local Supabase."
    )
    await page.getByLabel("E-mail").fill(email)
    await page.getByLabel("Senha").fill(password)
    await page.getByRole("button", { name: "Criar conta" }).click()
    await expect(
      page.getByRole("heading", { name: "Confirme seu e-mail" })
    ).toBeVisible()

    // Stand-in for clicking the link in the confirmation e-mail.
    const admin = createClient(adminEnv.url, adminEnv.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await admin.auth.admin.listUsers()
    const user = data.users.find((candidate) => candidate.email === email)
    expect(user).toBeDefined()
    await admin.auth.admin.updateUserById(user?.id ?? "", {
      email_confirm: true,
    })

    await page.goto("/entrar")
    await page.getByLabel("E-mail").fill(email)
    await page.getByLabel("Senha").fill(password)
    await page.getByRole("button", { name: "Entrar", exact: true }).click()

    await expect(page).toHaveURL(/\/aceite$/)
    await page
      .getByRole("checkbox", { name: "Li e aceito os Termos de uso" })
      .check()
    await page
      .getByRole("checkbox", { name: "Li e aceito a Política de privacidade" })
      .check()
    await page.getByRole("button", { name: "Aceitar e continuar" }).click()

    // J1: the onboarding wizard comes right after the terms; it can be resumed later.
    await expect(page).toHaveURL(/\/app\/onboarding$/)
    await page.getByRole("button", { name: "Continuar depois" }).click()
    await expect(page).toHaveURL(/\/app\/chat$/)
    await expect(
      page.getByRole("heading", { name: "Conversar", level: 2 })
    ).toBeVisible()

    const consents = await admin
      .from("consents")
      .select("purpose, version, granted")
      .eq("user_id", user?.id ?? "")
    expect(consents.data).toEqual(
      expect.arrayContaining([
        { purpose: "termos", version: "v1", granted: true },
        { purpose: "privacidade", version: "v1", granted: true },
      ])
    )

    await page.getByRole("button", { name: "Menu da conta" }).click()
    await page.getByRole("menuitem", { name: "Sair" }).click()
    await expect(page).toHaveURL(/\/entrar$/)
  })
})
