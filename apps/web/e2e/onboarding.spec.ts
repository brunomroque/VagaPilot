import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { fictitiousCvPdf } from "./fixtures/cv"
import {
  adminClient,
  createFictitiousUser,
  reachable,
  resolveAdminEnv,
  signInAndAccept,
} from "./support/supabase"

/*
 * P1.4 / CA1.1: a FICTITIOUS user signs up, uploads a fictitious CV, reviews the proposed facts
 * (CA2.1–CA2.3), fills the required answers and lands on /app/chat. Needs the local Supabase
 * stack; skipped explicitly without it. The LLM is the deterministic fake provider.
 */

const screenshotDir =
  process.env.E2E_SCREENSHOT_DIR ?? join("test-results", "screenshots")
mkdirSync(screenshotDir, { recursive: true })

const adminEnv = resolveAdminEnv()
const supabaseUp = await reachable(adminEnv)

function nextStep(page: Page) {
  return page
    .getByRole("navigation", { name: "Navegação do onboarding" })
    .getByRole("button", { name: /^Continuar/ })
}

async function stepHeading(page: Page, name: string) {
  await expect(page.getByRole("heading", { level: 3, name })).toBeVisible()
}

test.describe("onboarding (J1)", () => {
  test.skip(
    !supabaseUp,
    "Local Supabase is not running; onboarding e2e skipped."
  )
  test.setTimeout(240_000)

  test("CA1.1 a new fictitious user completes onboarding and reaches the chat", async ({
    page,
  }) => {
    if (!adminEnv) throw new Error("unreachable")
    const admin = adminClient(adminEnv)
    const user = await createFictitiousUser(admin, "Juliana Ficticia Ramos")

    await signInAndAccept(page, user.email)

    // 1. Upload
    await stepHeading(page, "Envie seus currículos")
    await expect(page.getByText("Etapa 1 de 6")).toBeVisible()
    await expect(nextStep(page)).toBeDisabled()
    await page.getByLabel("Arquivo do currículo").setInputFiles({
      name: "versao-ops-final2.pdf",
      mimeType: "application/pdf",
      buffer: await fictitiousCvPdf(),
    })
    await page.getByRole("button", { name: "Enviar e extrair fatos" }).click()
    await expect(
      page.getByText(/Currículo enviado\. \d+ fatos para revisar\./)
    ).toBeVisible({
      timeout: 60_000,
    })
    await expect(
      page.getByRole("list", { name: "Currículos enviados" })
    ).toContainText("versao ops final2")
    await nextStep(page).click()

    // 2. Facts grouped by experience (CA2.1), confirm / edit / reject (CA2.3)
    await stepHeading(page, "Confirme seus fatos")
    const alfa = page.getByRole("region", {
      name: "Engenheira de Software Sênior · Empresa Alfa Pagamentos",
    })
    await expect(alfa.getByText("Trecho do CV").first()).toBeAttached()
    await expect(
      page.getByRole("region", { name: /Beta Logística/ })
    ).toBeVisible()
    await expect(
      page.getByRole("region", { name: /Gama Consultoria/ })
    ).toBeVisible()
    await page.screenshot({
      path: join(screenshotDir, "p1-e2e-facts.png"),
      fullPage: true,
    })

    await alfa.getByRole("button", { name: "Confirmar todos" }).click()
    await expect(page.getByText("3 fatos confirmados")).toBeVisible()
    await expect(alfa).toBeHidden()

    await page
      .getByRole("button", { name: /^Rejeitar: Desenvolveu o roteirizador/ })
      .click()
    await expect(page.getByText("Fato rejeitado")).toBeVisible()

    await page
      .getByRole("button", { name: /^Editar e confirmar: Entregou 8 projetos/ })
      .click()
    const editDialog = page.getByRole("dialog", {
      name: "Editar e confirmar fato",
    })
    await editDialog
      .getByLabel("Fato")
      .fill("Entregou 8 projetos de integração para clientes do varejo.")
    await editDialog.getByRole("button", { name: "Salvar e confirmar" }).click()
    await expect(editDialog).toBeHidden()

    await page.getByRole("checkbox", { name: "Selecionar todos" }).check()
    await page.getByRole("button", { name: "Confirmar selecionados" }).click()
    await expect(page.getByText("Nenhum fato para revisar")).toBeVisible()

    const facts = await admin
      .from("confirmed_facts")
      .select("status, source_ref")
      .eq("user_id", user.id)
    const rows = (facts.data ?? []) as {
      status: string
      source_ref: { excerpt?: string; edited?: boolean } | null
    }[]
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(rows.every((row) => Boolean(row.source_ref?.excerpt))).toBe(true)
    expect(rows.filter((row) => row.status === "rejeitado")).toHaveLength(1)
    expect(rows.filter((row) => row.source_ref?.edited)).toHaveLength(1)
    expect(rows.filter((row) => row.status === "proposto")).toHaveLength(0)

    const auditRows = await admin
      .from("audit_log")
      .select("action")
      .eq("user_id", user.id)
      .like("action", "fact.%")
    const actions = ((auditRows.data ?? []) as { action: string }[]).map(
      (r) => r.action
    )
    expect(actions.filter((a) => a === "fact.proposed")).toHaveLength(
      rows.length
    )
    expect(actions.filter((a) => a === "fact.confirmed")).toHaveLength(
      rows.length - 1
    )
    expect(actions.filter((a) => a === "fact.rejected")).toHaveLength(1)

    await nextStep(page).click()

    // 3. Tracks and languages
    await stepHeading(page, "Organize por trilha e idioma")
    await page.getByRole("button", { name: "Nova trilha" }).click()
    const trackDialog = page.getByRole("dialog", { name: "Nova trilha" })
    await trackDialog.getByLabel("Nome").fill("Engenharia de Software")
    await trackDialog.getByRole("button", { name: "Salvar" }).click()
    await expect(trackDialog).toBeHidden()
    await page.getByRole("button", { name: "Editar", exact: true }).click()
    const versionDialog = page.getByRole("dialog", { name: "Editar versão" })
    await versionDialog
      .getByLabel("Trilha")
      .selectOption({ label: "Engenharia de Software" })
    await versionDialog.getByRole("button", { name: "Salvar" }).click()
    await expect(versionDialog).toBeHidden()
    await expect(
      page
        .getByRole("list", { name: "Versões de currículo" })
        .getByText("Padrão")
    ).toBeVisible()
    await nextStep(page).click()

    // 4. Required answers
    await stepHeading(page, "Respostas obrigatórias")
    await expect(nextStep(page)).toBeDisabled()
    const preferences = page
      .locator("form")
      .filter({ has: page.getByText("Modelos de trabalho aceitos") })
    await preferences.getByRole("checkbox", { name: "Remoto" }).check()
    await preferences.getByRole("checkbox", { name: "Híbrido" }).check()
    await preferences.getByRole("checkbox", { name: "CLT" }).check()
    await preferences
      .getByLabel("Disponibilidade para início")
      .selectOption("imediata")
    await preferences.getByRole("button", { name: "Salvar" }).click()
    await expect(page.getByText("Alterações salvas").first()).toBeVisible()

    await page.getByRole("button", { name: "Adicionar regra" }).click()
    const salaryDialog = page.getByRole("dialog", { name: "Adicionar regra" })
    await salaryDialog.getByLabel("Senioridade").selectOption("senior")
    await salaryDialog.getByLabel("Regime").selectOption("clt")
    await salaryDialog.getByLabel("Alvo").fill("20.000")
    await salaryDialog.getByRole("button", { name: "Salvar" }).click()
    await expect(salaryDialog).toBeHidden()

    await page.getByRole("button", { name: "Adicionar idioma" }).click()
    const languageDialog = page.getByRole("dialog", {
      name: "Adicionar idioma",
    })
    await languageDialog.getByLabel("Idioma").fill("Inglês")
    await languageDialog.getByLabel("Nível").selectOption("avancado")
    await languageDialog.getByLabel("CEFR (opcional)").selectOption("C1")
    await languageDialog.getByRole("button", { name: "Salvar" }).click()
    await expect(languageDialog).toBeHidden()

    await expect(nextStep(page)).toBeEnabled()
    await nextStep(page).click()

    // 5. Blocklist
    await stepHeading(page, "Empresas que você não quer")
    await page.getByRole("button", { name: "Bloquear empresa" }).click()
    const blockDialog = page.getByRole("dialog", { name: "Bloquear empresa" })
    await blockDialog.getByLabel("Empresa").fill("ACME Ltda.")
    await blockDialog.getByLabel("Domínios").fill("https://www.acme.com.br")
    await blockDialog.getByRole("button", { name: "Salvar" }).click()
    await expect(blockDialog).toBeHidden()
    await nextStep(page).click()

    // 6. Optional integrations, then finish
    await stepHeading(page, "Integrações opcionais")
    await expect(
      page.getByRole("button", { name: "Conectar Gmail" })
    ).toBeDisabled()
    await expect(
      page.getByRole("button", { name: "Instalar extensão" })
    ).toBeDisabled()
    await page
      .getByRole("button", { name: "Concluir e ir para o chat" })
      .click()

    await expect(page).toHaveURL(/\/app\/chat$/)
    await expect(
      page.getByRole("heading", { name: "Conversar", level: 2 })
    ).toBeVisible()
    await expect(
      page.getByText("Termine de configurar seu perfil")
    ).toBeHidden()

    const profile = await admin
      .from("candidate_profiles")
      .select("preferences")
      .eq("user_id", user.id)
      .single<{ preferences: { onboarding?: { completedAt?: string } } }>()
    expect(profile.data?.preferences.onboarding?.completedAt).toBeTruthy()
    const blocked = await admin
      .from("company_blocklist")
      .select("normalized_name, domains")
      .eq("user_id", user.id)
    expect(blocked.data).toEqual([
      { normalized_name: "acme", domains: ["acme.com.br"] },
    ])

    await admin.auth.admin.deleteUser(user.id)
  })

  test("save and resume: the wizard reopens at the saved step", async ({
    page,
  }) => {
    if (!adminEnv) throw new Error("unreachable")
    const admin = adminClient(adminEnv)
    const user = await createFictitiousUser(admin, "Rafaela Ficticia Lima")
    await signInAndAccept(page, user.email)

    await page.getByLabel("Arquivo do currículo").setInputFiles({
      name: "cv.pdf",
      mimeType: "application/pdf",
      buffer: await fictitiousCvPdf(),
    })
    await page.getByRole("button", { name: "Enviar e extrair fatos" }).click()
    await expect(page.getByText(/Currículo enviado/)).toBeVisible({
      timeout: 60_000,
    })
    await nextStep(page).click()
    await stepHeading(page, "Confirme seus fatos")

    await page.getByRole("button", { name: "Continuar depois" }).click()
    await expect(page).toHaveURL(/\/app\/chat$/)
    await expect(
      page.getByText("Termine de configurar seu perfil")
    ).toBeVisible()
    await page.getByRole("link", { name: "Continuar configuração" }).click()
    await expect(page).toHaveURL(/\/app\/onboarding$/)
    await stepHeading(page, "Confirme seus fatos")
    await expect(page.getByText("Etapa 2 de 6")).toBeVisible()

    await admin.auth.admin.deleteUser(user.id)
  })
})
