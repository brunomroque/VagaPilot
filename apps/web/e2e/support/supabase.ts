import { execSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, type Page } from "@playwright/test"

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

/** Logs in through the real form and accepts the terms; ends on the onboarding wizard. */
export async function signInAndAccept(page: Page, email: string) {
  await page.goto("/entrar")
  await page.getByLabel("E-mail").fill(email)
  await page.getByLabel("Senha").fill(FICTITIOUS_PASSWORD)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(/\/aceite$/)
  await page
    .getByRole("checkbox", { name: "Li e aceito os Termos de uso" })
    .check()
  await page
    .getByRole("checkbox", { name: "Li e aceito a Política de privacidade" })
    .check()
  await page.getByRole("button", { name: "Aceitar e continuar" }).click()
  await expect(page).toHaveURL(/\/app\/onboarding$/)
}
