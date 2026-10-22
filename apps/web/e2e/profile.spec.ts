import { expect, test } from "@playwright/test"

import {
  adminClient,
  createFictitiousUser,
  reachable,
  resolveAdminEnv,
  signInAndAccept,
} from "./support/supabase"

/*
 * P1.1: CA1.2 (sensitive fields encrypted at rest) and CA1.3 (diversity only with consent),
 * with a FICTITIOUS user against the local Supabase stack.
 */

const adminEnv = resolveAdminEnv()
const supabaseUp = await reachable(adminEnv)

function bytesOf(hex: string | null | undefined): string {
  if (!hex) return ""
  return Buffer.from(hex.replace(/^\\x/, ""), "hex").toString("latin1")
}

test.describe("profile", () => {
  test.skip(!supabaseUp, "Local Supabase is not running; profile e2e skipped.")
  test.setTimeout(120_000)

  test("CA1.2 documents and phone are stored encrypted, never in plain text", async ({
    page,
  }) => {
    if (!adminEnv) throw new Error("unreachable")
    const admin = adminClient(adminEnv)
    const user = await createFictitiousUser(admin, "Ana Ficticia Souza")
    await signInAndAccept(page, user.email)

    await page.goto("/app/perfil")
    await expect(
      page.getByRole("heading", { level: 2, name: "Seu perfil" })
    ).toBeVisible()

    const contact = page
      .locator("form")
      .filter({ has: page.getByLabel("Primeiro nome") })
    await contact.getByLabel("Telefone").fill("(11) 98888-7777")
    await contact.getByRole("button", { name: "Salvar" }).click()
    await expect(page.getByText("Alterações salvas").first()).toBeVisible()

    const documents = page
      .locator("form")
      .filter({ has: page.getByLabel("CPF") })
    await documents.getByLabel("CPF").fill("123.456.789-00")
    await documents.getByRole("button", { name: "Salvar" }).click()
    await expect(
      documents.getByText("CPF inválido. Confira os dígitos.")
    ).toBeVisible()
    await documents.getByLabel("CPF").fill("123.456.789-09")
    await documents.getByLabel("RG").fill("12.345.678-9")
    await documents.getByRole("button", { name: "Salvar" }).click()
    await expect(page.getByText("Alterações salvas").first()).toBeVisible()

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("candidate_profiles")
          .select("documents_enc")
          .eq("user_id", user.id)
          .single<{ documents_enc: string | null }>()
        return Boolean(data?.documents_enc)
      })
      .toBe(true)
    const { data } = await admin
      .from("candidate_profiles")
      .select("documents_enc, phone_enc")
      .eq("user_id", user.id)
      .single<{ documents_enc: string; phone_enc: string }>()
    for (const plain of ["123.456.789-09", "12345678909", "12.345.678-9"]) {
      expect(bytesOf(data?.documents_enc)).not.toContain(plain)
    }
    expect(bytesOf(data?.phone_enc)).not.toContain("98888")

    await page.reload()
    await expect(page.getByLabel("CPF")).toHaveValue("123.456.789-09")

    await admin.auth.admin.deleteUser(user.id)
  })

  test("CA1.3 diversity fields stay disabled until the consent is granted", async ({
    page,
  }) => {
    if (!adminEnv) throw new Error("unreachable")
    const admin = adminClient(adminEnv)
    const user = await createFictitiousUser(admin, "Bruna Ficticia Melo")
    await signInAndAccept(page, user.email)

    await page.goto("/app/perfil?secao=diversidade")
    const race = page.getByLabel("Raça/cor")
    await expect(race).toBeDisabled()
    await expect(
      page.getByRole("button", { name: "Salvar diversidade" })
    ).toBeDisabled()

    await page
      .getByRole("switch", {
        name: "Autorizo o tratamento dos meus dados de diversidade",
      })
      .click()
    await expect(page.getByText("Consentimento registrado")).toBeVisible()
    await expect(race).toBeEnabled()
    await race.selectOption("parda")
    await page.getByRole("button", { name: "Salvar diversidade" }).click()
    await expect(page.getByText("Alterações salvas").first()).toBeVisible()

    const saved = await admin
      .from("candidate_profiles")
      .select("diversity_enc")
      .eq("user_id", user.id)
      .single<{ diversity_enc: string | null }>()
    expect(saved.data?.diversity_enc).toBeTruthy()
    expect(bytesOf(saved.data?.diversity_enc)).not.toContain("parda")
    const consents = await admin
      .from("consents")
      .select("purpose, granted")
      .eq("user_id", user.id)
      .eq("purpose", "diversidade")
    expect(consents.data).toEqual([{ purpose: "diversidade", granted: true }])

    await page
      .getByRole("switch", {
        name: "Autorizo o tratamento dos meus dados de diversidade",
      })
      .click()
    await expect(
      page.getByText("Consentimento revogado e dados apagados")
    ).toBeVisible()
    await expect(race).toBeDisabled()
    const revoked = await admin
      .from("candidate_profiles")
      .select("diversity_enc")
      .eq("user_id", user.id)
      .single<{ diversity_enc: string | null }>()
    expect(revoked.data?.diversity_enc).toBeNull()

    await admin.auth.admin.deleteUser(user.id)
  })
})
