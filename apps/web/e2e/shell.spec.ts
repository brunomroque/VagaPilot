import { join } from "node:path"

import { expect, test } from "@playwright/test"

import { screenshotDir, settle, signInAsDevUser } from "./support"

/*
 * Smoke of the app shell with the FICTITIOUS seed data of Marina. Uses the dev-only session
 * from GET /dev/entrar (VAGAPILOT_DEV_AUTH_BYPASS=1, never active in production builds).
 * Read-only: tracker mutations live in tracker.spec.ts on rows created by the test.
 */

test.describe("app shell", () => {
  test("renders the chat-first home without hydration errors", async ({
    page,
  }) => {
    const hydrationErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat/i.test(message.text())) {
        hydrationErrors.push(message.text())
      }
    })

    await signInAsDevUser(page)
    await expect(page.getByTestId("chat-log")).toBeVisible()
    await expect(page.getByLabel("Mensagem")).toBeVisible()
    await page.goto("/app/visao-geral")
    await page.locator("[id^=DndLiveRegion]").waitFor({ state: "attached" })
    await expect(
      page.getByRole("region", { name: "Resumo de desempenho" })
    ).toBeVisible()

    await page.screenshot({
      path: join(screenshotDir, "01-overview-desktop.png"),
      fullPage: true,
    })
    expect(hydrationErrors).toEqual([])
  })

  test("navigates every sidebar route", async ({ page }) => {
    await signInAsDevUser(page)
    const sidebar = page.locator("[data-slot=sidebar-container]")
    const routes = [
      ["Candidaturas", "/app/candidaturas", "Candidaturas"],
      ["Tarefas", "/app/acoes", "Suas ações"],
      ["Currículos", "/app/cvs", null],
      ["Conversar", "/app/chat", null],
      ["Buscas salvas", "/app/buscas", null],
      ["Início (chat)", "/app", "VagaPilot"],
      ["Painel", "/app/visao-geral", "Pipeline de candidaturas"],
    ] as const

    for (const [label, path, heading] of routes) {
      await sidebar.getByRole("link", { name: label }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      if (heading) {
        await expect(
          page.getByRole("heading", { level: 2, name: heading, exact: true })
        ).toBeVisible()
      }
    }

    for (const [label, path] of [
      ["Perfil", "/app/perfil"],
      ["Configurações", "/app/configuracoes"],
    ] as const) {
      await page.getByRole("button", { name: "Menu da conta" }).click()
      await page.getByRole("menuitem", { name: label }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
  })

  test("Ctrl+K search opens an application in the detail sheet", async ({
    page,
  }) => {
    await signInAsDevUser(page)
    await page.keyboard.press("Control+k")
    const search = page.getByPlaceholder("Buscar candidatura ou página...")
    await expect(search).toBeFocused()
    await search.fill("stone")
    await page
      .getByRole("option", { name: /Stone · Diretora de Engenharia/ })
      .click()

    const sheet = page.locator("[data-slot=sheet-content]")
    await expect(
      sheet.getByRole("heading", { name: "Diretora de Engenharia" })
    ).toBeVisible()
    await expect(sheet.getByText("Aderência excelente")).toBeVisible()
    await expect(sheet.getByTestId("timeline")).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: "Preparar próxima etapa" })
    ).toBeVisible()
    await settle(page, "[data-slot=sheet-content]")
    await page.screenshot({ path: join(screenshotDir, "02-sheet-open.png") })
  })

  test("analyze dialog validates the links and opens the analysis in the chat", async ({
    page,
  }) => {
    await signInAsDevUser(page)
    await page.getByRole("button", { name: "Analisar nova vaga" }).click()
    const dialog = page.getByRole("dialog", {
      name: "Vamos analisar uma nova vaga",
    })
    await expect(
      dialog.getByText("Nada será enviado sem sua aprovação.")
    ).toBeVisible()

    await dialog.getByRole("button", { name: "Analisar com IA" }).click()
    await expect(
      dialog.getByText("Cole pelo menos um link válido de vaga.")
    ).toBeVisible()

    await dialog
      .getByLabel("Links das vagas")
      .fill("boards.greenhouse.io/empresaficticia/jobs/4001001")
    await dialog.getByRole("button", { name: "Analisar com IA" }).click()
    await expect(page).toHaveURL(/\/app\/chat/)
    await expect(page.getByTestId("chat-message-user").last()).toContainText(
      "https://boards.greenhouse.io/empresaficticia/jobs/4001001"
    )
    await expect(page.getByTestId("ingest-batch").last()).toBeVisible()
  })

  test("mobile layout collapses the sidebar into a drawer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInAsDevUser(page)

    await expect(page.locator("[data-slot=sidebar-container]")).toBeHidden()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    expect(overflow).toBe(false)
    await page.screenshot({
      path: join(screenshotDir, "03-mobile.png"),
      fullPage: true,
    })

    await page.getByRole("button", { name: "Alternar menu lateral" }).click()
    const drawer = page.locator("[data-mobile=true]")
    await expect(drawer.getByRole("link", { name: "Tarefas" })).toBeVisible()
    await settle(page, "[data-mobile=true]")
    await page.screenshot({
      path: join(screenshotDir, "04-mobile-sidebar.png"),
    })

    await drawer.getByRole("link", { name: "Tarefas" }).click()
    await expect(page).toHaveURL(/\/app\/acoes$/)
    await expect(drawer).toBeHidden()
  })
})
