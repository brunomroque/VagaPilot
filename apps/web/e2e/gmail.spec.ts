import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

import { screenshotDir, signInAsDevUser } from "./support"
import {
  adminClient,
  createFictitiousUser,
  reachable,
  resolveAdminEnv,
  signInAndAccept,
} from "./support/supabase"

/*
 * P4 Gmail with the FIXTURE Gmail backend (VAGAPILOT_GMAIL_MOCK=1: fake consent + fixture
 * mailbox, never Google). A fresh FICTITIOUS user connects, receives fictitious e-mails, syncs,
 * reviews and disconnects. Marina's seed connection is only read (mobile layout).
 */

const HOUR = 3_600_000
const FOOTER =
  "Este e-mail foi enviado automaticamente pela plataforma de recrutamento em nome da empresa contratante. " +
  "Seus dados pessoais são tratados conforme a LGPD e a política de privacidade da plataforma. " +
  "Para não receber mais comunicações sobre este processo, acesse as preferências da sua conta. " +
  "Não responda a esta mensagem: a caixa de entrada não é monitorada."

const BETA = "Empresa Fictícia Beta"
const GAMA = "Cooperativa Fictícia Gama"

function saoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`
}

function fixtureMessages(now: Date) {
  const at = (hoursAgo: number) =>
    new Date(now.getTime() - hoursAgo * HOUR).toISOString()
  return [
    {
      id: "e2e-codigo",
      from: "Gupy <no-reply@gupy.io>",
      subject: "Seu código de verificação",
      date: at(3),
      body: `Use o código 482913 para entrar. Ele expira em 10 minutos.\n\n${FOOTER}`,
    },
    {
      id: "e2e-teste",
      from: "InHire <notificacoes@inhire.app>",
      subject: `${BETA} | Próxima etapa: teste on-line`,
      date: at(2),
      body:
        `Olá! Você avançou no processo seletivo da ${BETA} para Gerente de Plataforma. ` +
        `Conclua o teste até ${saoPaulo(new Date(now.getTime() + 36 * HOUR))}. ` +
        `Acesse: https://teste.exemplo.test/etapa/7781\n\n${FOOTER}`,
    },
    {
      id: "e2e-ambigua",
      from: "Lever <no-reply@hire.lever.co>",
      subject: `${GAMA}: retorno do processo`,
      date: at(1),
      body:
        `Oi! Obrigado por participar do processo da ${GAMA} para Tech Lead. Neste momento não vamos seguir ` +
        `com sua candidatura para esta vaga, mas manteremos seu perfil no banco de talentos.\n\n${FOOTER}`,
    },
  ]
}

let admin: SupabaseClient | null = null
let user: { id: string; email: string } | null = null

test.beforeAll(async () => {
  const env = resolveAdminEnv()
  if (env && (await reachable(env))) admin = adminClient(env)
})

test.afterAll(async () => {
  if (admin && user) await admin.auth.admin.deleteUser(user.id)
})

async function mockEnabled(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/dev/gmail-mock")
  return response.ok()
}

async function insertApplication(
  company: string,
  role: string,
  status: string
) {
  const { data, error } = await admin!
    .from("applications")
    .insert({
      user_id: user!.id,
      company,
      role_title: role,
      source: "gupy",
      route: "extensao",
      status,
      applied_at: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
      created_at: new Date(Date.now() - 6 * 24 * HOUR).toISOString(),
    })
    .select("id")
    .single<{ id: string }>()
  if (error || !data) throw new Error(error?.message)
  return data.id
}

test("CA11.5 CA11.3 conecta o Gmail (mock), sincroniza com evidência, revisa e desconecta", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(240_000)
  test.skip(
    !admin,
    "Local Supabase is not running (supabase start); Gmail e2e skipped."
  )
  test.skip(
    !(await mockEnabled(page)),
    "VAGAPILOT_GMAIL_MOCK=1 is not set on the dev server."
  )

  user = await createFictitiousUser(admin!, "Ana Fictícia")
  const betaId = await insertApplication(
    BETA,
    "Gerente de Plataforma",
    "enviada"
  )
  const gamaId = await insertApplication(GAMA, "Tech Lead", "em_analise")
  await signInAndAccept(page, user.email)
  await admin!.from("consents").insert({
    user_id: user.id,
    purpose: "risk_gmail",
    version: "v1",
    granted: true,
  })
  await admin!.from("subscriptions").upsert({
    user_id: user.id,
    plan: "pro",
    status: "trialing",
  })

  // P4.1: explanation of what is and is not read, then incremental consent (gmail.readonly only).
  await page.goto("/app/configuracoes")
  await expect(page.getByRole("heading", { name: "Integrações" })).toBeVisible()
  await expect(page.getByText("Não conectado", { exact: true })).toBeVisible()
  await expect(page.getByText("O que lemos")).toBeVisible()
  await expect(page.getByText("O que não lemos")).toBeVisible()
  await expect(page.getByText("Modo de teste: e-mails fictícios")).toBeVisible()
  await page.screenshot({
    path: join(screenshotDir, "p4-e2e-01-settings.png"),
    fullPage: true,
  })

  await page
    .getByRole("link", { name: "Conectar para acompanhar status" })
    .click()
  await expect(page).toHaveURL(/\/app\/configuracoes$/)
  await expect(
    page.getByText("Gmail conectado. Lemos os últimos 90 dias filtrados.")
  ).toBeVisible()
  await expect(page.getByText("Conectado", { exact: true })).toBeVisible()
  await expect(page.getByText("Leitura de e-mails de processos")).toBeVisible()
  await expect(
    page.getByRole("link", {
      name: "Permitir envio de candidaturas por e-mail",
    })
  ).toBeVisible()

  const { data: consent } = await admin!
    .from("consents")
    .select("granted")
    .eq("user_id", user.id)
    .eq("purpose", "gmail_leitura")
    .single<{ granted: boolean }>()
  expect(consent?.granted).toBe(true)
  const { data: token } = await admin!
    .from("gmail_connections")
    .select("refresh_token_enc, scopes")
    .eq("user_id", user.id)
    .single<{ refresh_token_enc: string; scopes: string[] }>()
  expect(token?.scopes).toEqual([
    "https://www.googleapis.com/auth/gmail.readonly",
  ])
  const sealed = Buffer.from(
    token!.refresh_token_enc.replace(/^\\x/, ""),
    "hex"
  ).toString("latin1")
  expect(sealed).not.toContain("mock-refresh")

  // Fictitious e-mails arrive, then "Sincronizar agora".
  const delivered = await page.request.post("/api/dev/gmail-mock", {
    data: { messages: fixtureMessages(new Date()) },
    headers: { origin: baseURL ?? "" },
  })
  expect(delivered.ok()).toBe(true)
  await page.getByRole("button", { name: "Sincronizar agora" }).click()
  await expect(
    page.getByText("Sincronizado: 1 atualização e 1 para revisar.")
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "1 e-mail para revisar" })
  ).toBeVisible()

  // CA11.4: only metadata and a ≤ 500 char snippet; the verification code was never stored.
  const { data: threads } = await admin!
    .from("email_threads")
    .select("*")
    .eq("user_id", user.id)
  expect(threads?.map((row) => row.gmail_message_id).sort()).toEqual([
    "e2e-ambigua",
    "e2e-teste",
  ])
  for (const row of threads ?? []) {
    expect(String(row.snippet).length).toBeLessThanOrEqual(500)
    expect(JSON.stringify(row)).not.toContain(
      "a caixa de entrada não é monitorada"
    )
  }

  // CA11.5: automatic change shows source, confidence and evidence.
  await page.goto("/app/candidaturas")
  await page.keyboard.press("Control+k")
  await page.getByPlaceholder("Buscar candidatura ou página...").fill("Beta")
  await page
    .getByRole("option", {
      name: new RegExp(`${BETA} · Gerente de Plataforma`),
    })
    .click()
  const sheet = page.locator("[data-slot=sheet-content]")
  const timeline = sheet.getByTestId("timeline")
  await expect(timeline).toContainText("Enviada → Teste/Etapa pendente")
  await expect(timeline).toContainText("Gmail")
  await expect(timeline).toContainText("confiança 90%")
  await expect(timeline).toContainText("com evidência")
  await expect(
    sheet.getByText(/De: InHire <notificacoes@inhire\.app>/)
  ).toBeVisible()
  await page.screenshot({ path: join(screenshotDir, "p4-e2e-02-timeline.png") })
  await page.keyboard.press("Escape")

  // Low confidence went to "Revise"; the deadline is in "Suas ações".
  await page.goto("/app/acoes")
  const review = page.locator("#revise")
  await expect(review.getByRole("heading", { name: /Revise/ })).toBeVisible()
  const item = review
    .getByTestId("review-item")
    .filter({ hasText: `${GAMA}: retorno do processo` })
  await expect(item.getByText("Confiança 62%")).toBeVisible()
  await expect(item.getByText("Sugestão: mover para Reprovada")).toBeVisible()
  await expect(
    page.getByText("Concluir teste ou etapa do processo")
  ).toBeVisible()
  await page.screenshot({
    path: join(screenshotDir, "p4-e2e-03-revise.png"),
    fullPage: true,
  })
  await item.getByRole("button", { name: "Confirmar" }).click()
  await expect(
    page.getByText(
      "Confirmado. A candidatura foi atualizada com o e-mail como evidência."
    )
  ).toBeVisible()
  await expect(review).toBeHidden()

  const { data: statuses } = await admin!
    .from("applications")
    .select("id, status")
    .in("id", [betaId, gamaId])
  expect(
    Object.fromEntries((statuses ?? []).map((row) => [row.id, row.status]))
  ).toEqual({
    [betaId]: "etapa_pendente",
    [gamaId]: "reprovada",
  })

  // Bell: Gmail update and the 48 h reminder of the new deadline.
  const bell = page.getByRole("button", {
    name: /Notificações\. \d+ não lidas?/,
  })
  await bell.click()
  await expect(
    page.getByRole("menuitem", {
      name: /Empresa Fictícia Beta: status atualizado para Teste\/Etapa pendente/,
    })
  ).toBeVisible()
  await expect(
    page.getByRole("menuitem", {
      name: /Prazo em 48 horas: Concluir teste ou etapa do processo/,
    })
  ).toBeVisible()
  await page.screenshot({ path: join(screenshotDir, "p4-e2e-04-bell.png") })
  await page.keyboard.press("Escape")

  // CA11.3: disconnect revokes, deletes the token and withdraws the consent.
  await page.goto("/app/configuracoes")
  await page.getByRole("button", { name: "Desconectar" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Desconectar o Gmail?" })
  await dialog.getByRole("button", { name: "Desconectar" }).click()
  await expect(page.getByText("Gmail desconectado")).toBeVisible()
  await expect(page.getByText("Não conectado", { exact: true })).toBeVisible()

  const { data: connection } = await admin!
    .from("gmail_connections")
    .select("user_id")
    .eq("user_id", user.id)
  expect(connection).toEqual([])
  const { data: latest } = await admin!
    .from("consents")
    .select("granted")
    .eq("user_id", user.id)
    .eq("purpose", "gmail_leitura")
    .order("created_at", { ascending: false })
    .limit(1)
    .single<{ granted: boolean }>()
  expect(latest?.granted).toBe(false)
  const { data: auditRows } = await admin!
    .from("audit_log")
    .select("action")
    .eq("user_id", user.id)
    .in("action", ["gmail.connected", "gmail.synced", "gmail.revoked"])
  expect(new Set(auditRows?.map((row) => row.action))).toEqual(
    new Set(["gmail.connected", "gmail.synced", "gmail.revoked"])
  )
})

test("settings and the Gmail card fit a 390 px screen (seed connection, read-only)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsDevUser(page, "/app/configuracoes")
  await expect(page.getByRole("heading", { name: "Integrações" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sincronizar agora" })
  ).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  )
  expect(overflow).toBe(false)
  await page.screenshot({
    path: join(screenshotDir, "p4-e2e-05-settings-mobile.png"),
    fullPage: true,
  })
})
