import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  adminClient,
  MARINA_ID,
  screenshotDir,
  settle,
  signInAsDevUser,
} from "./support"

/*
 * P3.1/P3.2 tracker against the local Supabase as the FICTITIOUS user Marina. Every test works
 * on its own rows (company prefixed with RUN) and deletes them afterwards.
 */

const RUN = `E2E ${Date.now().toString(36)}`

let admin: SupabaseClient | null = null

test.beforeAll(async () => {
  admin = await adminClient()
})

test.afterAll(async () => {
  await admin
    ?.from("applications")
    .delete()
    .eq("user_id", MARINA_ID)
    .like("company", `${RUN}%`)
})

test.beforeEach(() => {
  test.skip(
    !admin,
    "Local Supabase is not running (supabase start); tracker e2e skipped."
  )
})

async function search(page: Page, text: string) {
  await page.getByRole("searchbox", { name: "Buscar candidaturas" }).fill(text)
}

async function dragTo(page: Page, card: Locator, target: Locator) {
  const from = await card.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error("board not rendered")
  await page.mouse.move(from.x + from.width / 2, from.y + 30)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 })
  await page.mouse.up()
}

test("P3.1 cria candidatura manual, muda status pela tabela e pelo kanban e registra na linha do tempo", async ({
  page,
}) => {
  const company = `${RUN} Aurora`
  await signInAsDevUser(page, "/app/candidaturas")

  await page.getByRole("button", { name: "Nova candidatura" }).click()
  const dialog = page.getByRole("dialog", { name: "Nova candidatura" })
  await dialog.getByLabel("Empresa").fill(company)
  await dialog
    .getByLabel("Cargo", { exact: true })
    .fill("Coordenadora de Produto")
  await dialog.getByLabel("Fonte").selectOption("gupy")
  await dialog.getByLabel("Status").selectOption("rascunho")
  await dialog.getByRole("button", { name: "Criar candidatura" }).click()
  await expect(page.getByText(`Candidatura na ${company} criada`)).toBeVisible()

  const sheet = page.locator("[data-slot=sheet-content]")
  await expect(
    sheet.getByRole("heading", { name: "Coordenadora de Produto" })
  ).toBeVisible()
  await expect(sheet.getByTestId("timeline")).toContainText(
    "Candidatura registrada como Rascunho"
  )
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()

  // Table: fine-grained status from the row menu.
  await search(page, company)
  await expect(page.getByText(/^1 de \d+ candidaturas$/)).toBeVisible()
  await page
    .getByRole("button", { name: `Ações da candidatura ${company}` })
    .click()
  await page.getByRole("menuitem", { name: "Enviada" }).click()
  await expect(page.getByText(`${company}: Enviada`)).toBeVisible()
  const table = page.getByTestId("applications-table")
  await expect(table.getByText("Enviada", { exact: true })).toBeVisible()
  await page.screenshot({ path: join(screenshotDir, "p3-e2e-01-table.png") })

  // Kanban: valid drop with a choice, then an invalid drop.
  await page.getByRole("tab", { name: "Kanban" }).click()
  const card = page.locator(`[data-company="${company}"]`)
  await expect(
    page.getByTestId("column-candidatadas").locator(card)
  ).toBeVisible()
  await dragTo(page, card, page.getByTestId("column-em_processo"))
  const choose = page.getByRole("dialog", { name: "Qual é o novo status?" })
  await expect(choose).toBeVisible()
  await settle(page, "[role=dialog]")
  await page.screenshot({
    path: join(screenshotDir, "p3-e2e-02-kanban-choose.png"),
  })
  await choose.getByRole("button", { name: "Entrevista" }).click()
  await expect(page.getByText(`${company}: Entrevista`)).toBeVisible()
  await expect(
    page.getByTestId("column-em_processo").locator(card)
  ).toBeVisible()

  await card.focus()
  const announcer = page.locator("[id^=DndLiveRegion]")
  await expect(card).toBeFocused()
  await page.keyboard.press("Space")
  await expect(announcer).toHaveText(
    new RegExp(`^${company} (selecionada em|sobre) Em processo\\.$`)
  )
  // The keyboard sensor binds its listeners on the next frame after activation.
  await page.waitForTimeout(300)
  await page.keyboard.press("ArrowLeft")
  await expect(announcer).toHaveText(`${company} sobre Candidatadas.`)
  await page.keyboard.press("ArrowLeft")
  await expect(announcer).toHaveText(`${company} sobre Descobertas.`)
  await page.keyboard.press("Space")
  await expect(
    page.getByText(`${company} não pode ir de Entrevista para Descobertas.`)
  ).toBeVisible()
  await page.screenshot({
    path: join(screenshotDir, "p3-e2e-03-kanban-invalid.png"),
  })
  await expect(
    page.getByTestId("column-em_processo").locator(card)
  ).toBeVisible()

  await card.press("Enter")
  const timeline = sheet.getByTestId("timeline")
  await expect(timeline).toContainText("Enviada → Entrevista")
  await expect(timeline).toContainText("Rascunho → Enviada")
  await expect(timeline).toContainText("Você")
  await settle(page, "[data-slot=sheet-content]")
  await page.screenshot({ path: join(screenshotDir, "p3-e2e-04-timeline.png") })

  const { data: application } = await admin!
    .from("applications")
    .select("id, status")
    .eq("company", company)
    .single()
  expect(application?.status).toBe("entrevista")
  const { data: events } = await admin!
    .from("application_events")
    .select("type, from_status, to_status, source")
    .eq("application_id", application?.id)
    .order("occurred_at")
  expect(events).toEqual([
    {
      type: "status_change",
      from_status: null,
      to_status: "rascunho",
      source: "usuario",
    },
    {
      type: "status_change",
      from_status: "rascunho",
      to_status: "enviada",
      source: "usuario",
    },
    {
      type: "status_change",
      from_status: "enviada",
      to_status: "entrevista",
      source: "usuario",
    },
  ])
  const { data: audit } = await admin!
    .from("audit_log")
    .select("action, actor")
    .eq("target_id", application?.id)
  expect(audit?.filter((row) => row.action === "status.changed")).toHaveLength(
    3
  )
})

test("CA10.1 exportação CSV baixa com BOM, separador ; e datas dd/mm/aaaa", async ({
  page,
}) => {
  const company = `${RUN} Exportação Ação`
  await admin!.from("applications").insert({
    user_id: MARINA_ID,
    company,
    role_title: "Analista de Operações",
    source: "indicacao",
    route: "manual",
    status: "em_analise",
    applied_at: "2026-10-05T13:00:00Z",
  })
  await signInAsDevUser(page, "/app/candidaturas")
  await search(page, company)
  await expect(page.getByText(/^1 de \d+ candidaturas$/)).toBeVisible()

  await page.getByRole("button", { name: "Exportar" }).click()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Planilha CSV (Excel)" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^vagapilot-candidaturas-\d{4}-\d{2}-\d{2}\.csv$/
  )
  const bytes = readFileSync(await download.path())
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = bytes.subarray(3).toString("utf8")
  const [header, row, end] = text.split("\r\n")
  expect(header).toBe(
    "Data;Empresa;Cargo;Fonte;Rota;Link;CV usado;Pretensão;Regime;Status;Próxima ação;Prazo;Notas"
  )
  expect(row).toBe(
    `05/10/2026;${company};Analista de Operações;Indicação;Manual;;;;;Em análise;;;`
  )
  expect(end).toBe("")

  const pdf = await page.request.get(
    `/api/applications/export?format=pdf&q=${encodeURIComponent(company)}`
  )
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()["content-type"]).toBe("application/pdf")
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-")

  const invalid = await page.request.get("/api/applications/export?format=xls")
  expect(invalid.status()).toBe(400)
  expect(await invalid.json()).toEqual({
    error: { code: "invalid_request", message: "Invalid export filters." },
  })
})

test("CA10.3 importação de 200 linhas conclui em < 10 s e reporta linhas rejeitadas", async ({
  page,
}) => {
  const lines = ["Empresa;Cargo;Fonte;Situação;Data de envio"]
  for (let index = 0; index < 200; index += 1) {
    const invalid = index % 20 === 0
    lines.push(
      `${RUN} Import ${index};${invalid ? "" : "Analista"};Gupy;Enviada;0${(index % 9) + 1}/10/2026`
    )
  }
  await signInAsDevUser(page, "/app/candidaturas")
  await page.getByRole("button", { name: "Importar CSV" }).click()
  const dialog = page.getByRole("dialog", { name: "Importar planilha" })
  await dialog.getByLabel("Arquivo CSV").setInputFiles({
    name: "planilha-ficticia.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8"),
  })
  await expect(
    dialog.getByText("planilha-ficticia.csv: 200 linhas")
  ).toBeVisible()
  await expect(dialog.getByLabel("Empresa (obrigatório)")).toHaveValue("0")

  const started = Date.now()
  await dialog.getByRole("button", { name: "Importar 200 linhas" }).click()
  const summary = dialog.getByTestId("import-summary")
  await expect(summary).toContainText("190 candidaturas importadas", {
    timeout: 10_000,
  })
  expect(Date.now() - started).toBeLessThan(10_000)
  await expect(summary).toContainText("10 linhas rejeitadas")
  await expect(summary).toContainText("Linha 2: cargo vazio")
  await page.screenshot({ path: join(screenshotDir, "p3-e2e-05-import.png") })

  const { count } = await admin!
    .from("applications")
    .select("id", { count: "exact", head: true })
    .like("company", `${RUN} Import %`)
  expect(count).toBe(190)
})

test("P3.2 marca a ação como feita em Tarefas e a visão geral acompanha", async ({
  page,
}) => {
  const company = `${RUN} Tarefa`
  const action = `Enviar teste técnico ${RUN}`
  const { data } = await admin!
    .from("applications")
    .insert({
      user_id: MARINA_ID,
      company,
      role_title: "Engenheira de Dados",
      source: "lever",
      route: "manual",
      status: "etapa_pendente",
      next_action: action,
      next_action_due_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()

  await signInAsDevUser(page, "/app/acoes")
  const item = page.getByTestId(`action-${data?.id}`)
  await expect(item).toContainText(action)
  await expect(item).toContainText("Atrasada")
  await page.screenshot({ path: join(screenshotDir, "p3-e2e-06-tarefas.png") })
  await item
    .getByRole("button", { name: `Marcar como feita: ${action} (${company})` })
    .click()
  await expect(page.getByText("Ação concluída")).toBeVisible()
  await expect(item).toBeHidden()

  const { data: events } = await admin!
    .from("application_events")
    .select("type, source, payload")
    .eq("application_id", data?.id)
  expect(events).toEqual([
    {
      type: "deadline_set",
      source: "usuario",
      payload: expect.objectContaining({ action, done: true }),
    },
  ])

  await page
    .locator("[data-slot=sidebar-container]")
    .getByRole("link", { name: "Visão geral" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Pipeline de candidaturas" })
  ).toBeVisible()
  await expect(page.getByText(action)).toBeHidden()
})
