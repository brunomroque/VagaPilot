import { randomUUID } from "node:crypto"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

import {
  adminClient,
  MARINA_ID,
  screenshotDir,
  signInAsDevUser,
} from "./support"

/**
 * P2.4/P2.5 e2e (F4, F7, F14). Links are FICTITIOUS fixtures served by the fixture fetch
 * (VAGAPILOT_ATS_FIXTURES=1, no network). Each test uses its own conversation and removes the
 * rows it created. The dev session is the fictitious seed user Marina.
 */

const LINKS = {
  greenhouse: "https://boards.greenhouse.io/empresaficticia/jobs/4001001",
  lever:
    "https://jobs.lever.co/exemplotech/8b1c2d3e-0000-4000-8000-000000000001",
  gupy: "https://empresaficticia.gupy.io/jobs/1001",
  injection: "https://logisticaficticia.gupy.io/jobs/1666",
  missing: "https://vagas.exemplo.test/nao-existe-404",
}

let admin: SupabaseClient | null = null

test.beforeAll(async () => {
  admin = await adminClient()
})

async function requireAdmin(): Promise<SupabaseClient> {
  test.skip(!admin, "Local Supabase is not running (supabase start).")
  return admin as SupabaseClient
}

async function openNewConversation(page: Page) {
  await signInAsDevUser(page, "/app/chat")
  await page.getByRole("button", { name: "Nova conversa" }).click()
  await expect(page).toHaveURL(/\/app\/chat\?c=[0-9a-f-]{36}$/)
  await expect(page.getByLabel("Mensagem")).toBeVisible()
}

async function send(page: Page, text: string) {
  const input = page.getByLabel("Mensagem")
  await input.fill(text)
  await input.press("Enter")
}

/** Removes Marina's analyses and applications for the given canonical links. */
async function cleanupJobs(db: SupabaseClient, links: string[]) {
  const { data } = await db
    .from("job_postings")
    .select("id")
    .in("canonical_url", links)
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id)
  if (ids.length === 0) return
  const matches = await db
    .from("job_matches")
    .select("id")
    .eq("user_id", MARINA_ID)
    .in("job_posting_id", ids)
  const matchIds = ((matches.data ?? []) as { id: string }[]).map(
    (row) => row.id
  )
  if (matchIds.length > 0) {
    await db
      .from("applications")
      .delete()
      .eq("user_id", MARINA_ID)
      .in("job_match_id", matchIds)
  }
  await db
    .from("job_ingestions")
    .delete()
    .eq("user_id", MARINA_ID)
    .in("job_posting_id", ids)
  await db
    .from("job_matches")
    .delete()
    .eq("user_id", MARINA_ID)
    .in("job_posting_id", ids)
}

async function cleanupConversation(db: SupabaseClient, page: Page) {
  const id = new URL(page.url()).searchParams.get("c")
  if (id)
    await db
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", MARINA_ID)
}

test.describe("chat with widgets (P2.4)", () => {
  test.describe.configure({ mode: "serial" })

  test("CA7.1 three fixture links show three JobCards incrementally; Pular marks the job descartada", async ({
    page,
  }) => {
    const db = await requireAdmin()
    const links = [LINKS.greenhouse, LINKS.lever, LINKS.gupy]
    await cleanupJobs(db, links)
    await openNewConversation(page)

    await send(page, links.join("\n"))
    const batch = page.getByTestId("ingest-batch")
    await expect(batch).toBeVisible()
    await expect(batch.getByRole("status").first()).toBeVisible()
    const cards = page.getByTestId("job-card")
    await expect(cards).toHaveCount(3, { timeout: 30_000 })
    await expect(page.getByText("3 vagas analisadas.")).toBeVisible()

    const gupy = page.getByRole("article", {
      name: "Coordenador(a) de Infraestrutura",
    })
    await expect(gupy.getByText("Empresa Fictícia Varejo")).toBeVisible()
    await expect(gupy.getByRole("group", { name: /Ações para/ })).toBeVisible()
    await page.screenshot({
      path: join(screenshotDir, "p2-e2e-batch.png"),
      fullPage: true,
    })

    const lever = page.getByRole("article", { name: "Gerente de Engenharia" })
    await lever.getByRole("button", { name: "Salvar" }).click()
    await expect(lever.getByTestId("status-change-card")).toContainText(
      "Rascunho"
    )

    const started = Date.now()
    await gupy.getByRole("button", { name: "Pular" }).click()
    await expect(gupy.getByTestId("status-change-card")).toContainText("Pulada")
    const elapsed = Date.now() - started
    test.info().annotations.push({
      type: "CA7.1 Pular (ms)",
      description: String(elapsed),
    })
    expect(elapsed).toBeLessThan(1_000)

    const { data: posting } = await db
      .from("job_postings")
      .select("id")
      .eq("canonical_url", LINKS.gupy)
      .single()
    const { data: match } = await db
      .from("job_matches")
      .select("id, decision")
      .eq("user_id", MARINA_ID)
      .eq("job_posting_id", (posting as { id: string }).id)
      .single()
    expect((match as { decision: string }).decision).toBe("pular")
    const { data: application } = await db
      .from("applications")
      .select("status")
      .eq("user_id", MARINA_ID)
      .eq("job_match_id", (match as { id: string }).id)
      .single()
    expect((application as { status: string }).status).toBe("descartada")

    await cleanupJobs(db, links)
    await cleanupConversation(db, page)
  })

  test("CA4.2 an unreadable link shows a clear message and a paste field within 10 s", async ({
    page,
  }) => {
    const db = await requireAdmin()
    await openNewConversation(page)
    await send(page, LINKS.missing)
    const failed = page.getByTestId("ingest-failed")
    await expect(failed).toBeVisible({ timeout: 10_000 })
    await expect(failed).toContainText("Não consegui ler a vaga")
    await failed
      .getByLabel("Texto da vaga")
      .fill(
        "Gerente de Engenharia\nEmpresa Fictícia Exemplo\nRequisitos\n- Kubernetes\n- Liderança de times de engenharia"
      )
    await failed.getByRole("button", { name: "Analisar texto" }).click()
    await expect(
      page.getByRole("article", { name: "Gerente de Engenharia" })
    ).toBeVisible({ timeout: 20_000 })
    await db
      .from("job_ingestions")
      .delete()
      .eq("user_id", MARINA_ID)
      .eq("input_url", LINKS.missing)
    await cleanupConversation(db, page)
  })

  test("CA14.8 instructions hidden or written in a job posting trigger no action", async ({
    page,
  }) => {
    const db = await requireAdmin()
    await cleanupJobs(db, [LINKS.injection])
    const startedAt = new Date().toISOString()
    const mode = (
      await db
        .from("user_settings")
        .select("approval_mode")
        .eq("user_id", MARINA_ID)
        .maybeSingle()
    ).data

    await openNewConversation(page)
    const conversationId = new URL(page.url()).searchParams.get("c") ?? ""
    await send(page, LINKS.injection)
    await expect(
      page.getByRole("article", { name: "Gerente de Plataforma" })
    ).toBeVisible({ timeout: 30_000 })

    const memory = await db
      .from("memory_events")
      .select("id")
      .eq("user_id", MARINA_ID)
      .eq("conversation_id", conversationId)
      .gte("created_at", startedAt)
    expect(memory.data ?? []).toEqual([])
    const internSearches = await db
      .from("saved_searches")
      .select("id")
      .eq("user_id", MARINA_ID)
      .ilike("query", "%estagi%")
      .gte("created_at", startedAt)
    expect(internSearches.data ?? []).toEqual([])
    const excluded = await db
      .from("excluded_companies")
      .select("id")
      .eq("user_id", MARINA_ID)
      .ilike("normalized_name", "%concorrente%")
    expect(excluded.data ?? []).toEqual([])
    expect(
      (
        await db
          .from("user_settings")
          .select("approval_mode")
          .eq("user_id", MARINA_ID)
          .maybeSingle()
      ).data
    ).toEqual(mode)
    const { data: blocked } = await db
      .from("audit_log")
      .select("id")
      .eq("user_id", MARINA_ID)
      .eq("action", "chat.injection_blocked")
      .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    expect((blocked ?? []).length).toBeGreaterThan(0)

    await cleanupJobs(db, [LINKS.injection])
    await cleanupConversation(db, page)
  })

  test("CA14.9 off-topic requests are refused without calling the agent", async ({
    page,
  }) => {
    const db = await requireAdmin()
    await openNewConversation(page)
    await send(page, "me passa uma receita de bolo de cenoura")
    await expect(
      page.getByTestId("chat-message-assistant").last()
    ).toContainText("Posso ajudar com suas vagas, CVs e candidaturas")
    await cleanupConversation(db, page)
  })
})

test.describe("chat that configures the app (P2.5, F14)", () => {
  test.describe.configure({ mode: "serial" })

  test("CA14.2 a low-risk preference set by chat is undone to the exact previous state", async ({
    page,
  }) => {
    const db = await requireAdmin()
    await db
      .from("preferences")
      .delete()
      .eq("user_id", MARINA_ID)
      .eq("key", "email.include_salary")
    await openNewConversation(page)

    await send(page, "não cite pretensão em e-mail")
    const card = page.getByTestId("settings-diff-card").last()
    await expect(card).toContainText("Preferência")
    await expect(card).toContainText("Aplicada")
    const applied = await db
      .from("preferences")
      .select("value")
      .eq("user_id", MARINA_ID)
      .eq("key", "email.include_salary")
      .maybeSingle()
    expect((applied.data as { value: unknown } | null)?.value).toBe(false)

    await card.getByRole("button", { name: "Desfazer" }).click()
    await expect(card).toContainText("Desfeita")
    const restored = await db
      .from("preferences")
      .select("value")
      .eq("user_id", MARINA_ID)
      .eq("key", "email.include_salary")
      .maybeSingle()
    expect(restored.data).toBeNull()

    await page.goto("/app/memoria")
    await expect(page.getByTestId("memory-event").first()).toHaveAttribute(
      "data-status",
      "desfeita"
    )
    await page.screenshot({
      path: join(screenshotDir, "p2-e2e-memory.png"),
      fullPage: true,
    })
    await cleanupConversation(db, page)
  })

  test("CA14.7 a saved search created by chat equals the one created by the form", async ({
    page,
  }) => {
    const db = await requireAdmin()
    const tag = `E2E${randomUUID().slice(0, 6)}`
    const query = `gerente de TI ${tag}`
    await openNewConversation(page)
    const conversationUrl = page.url()

    await send(
      page,
      `quero vagas de ${query} em São Paulo, híbrido, toda manhã`
    )
    await expect(page.getByTestId("settings-diff-card").last()).toContainText(
      "Nova busca salva"
    )

    await page.goto("/app/buscas")
    await page.getByRole("button", { name: "Nova busca" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Nova busca salva" })
    await dialog.getByLabel("Cargo ou palavras-chave").fill(query)
    await dialog.getByLabel("Local").fill("São Paulo")
    await dialog.getByLabel("Nível").selectOption("gerente")
    await dialog.getByLabel("Modelo").selectOption("hibrido")
    await dialog.getByLabel("Frequência").selectOption("diaria")
    await dialog.getByLabel("Horário").selectOption("manha")
    await dialog.getByRole("button", { name: "Salvar busca" }).click()
    await expect(dialog).toBeHidden()

    const { data } = await db
      .from("saved_searches")
      .select("*")
      .eq("user_id", MARINA_ID)
      .eq("query", query)
      .order("created_at", { ascending: true })
    const rows = (data ?? []) as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    const strip = (row: Record<string, unknown>) => {
      const {
        id: _id,
        created_at: _c,
        updated_at: _u,
        last_run_at: _l,
        ...rest
      } = row
      return rest
    }
    expect(strip(rows[0] as Record<string, unknown>)).toEqual(
      strip(rows[1] as Record<string, unknown>)
    )

    const { data: events } = await db
      .from("memory_events")
      .select("origin, intent")
      .eq("user_id", MARINA_ID)
      .in(
        "target_id",
        rows.map((row) => row.id as string)
      )
    expect(
      ((events ?? []) as { origin: string }[])
        .map((event) => event.origin)
        .sort()
    ).toEqual(["chat", "formulario"])

    await db
      .from("memory_events")
      .delete()
      .eq("user_id", MARINA_ID)
      .in(
        "target_id",
        rows.map((row) => row.id as string)
      )
    await db
      .from("saved_searches")
      .delete()
      .eq("user_id", MARINA_ID)
      .eq("query", query)
    await page.goto(conversationUrl)
    await cleanupConversation(db, page)
  })
})
