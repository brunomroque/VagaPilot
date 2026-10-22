import { expect, test } from "@playwright/test"

import { signInAsDevUser } from "./support"

test.describe("Extension API (P5, CA8.1)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDevUser(page, "/app/configuracoes")
  })

  test("CA8.1 pairing code pairs a device token", async ({ page }) => {
    const init = await page.request.post("/api/ext/pair/init")
    expect(init.ok()).toBeTruthy()
    const { code } = (await init.json()) as { code: string }
    expect(code).toMatch(/^\d{6}$/)

    const paired = await page.request.post("/api/ext/pair", {
      data: { code, deviceName: "Playwright fictício" },
    })
    expect(paired.ok()).toBeTruthy()
    const { token } = (await paired.json()) as { token: string }
    expect(token.startsWith("vp_dev_")).toBe(true)
  })

  test("CA8.2 dev ATS fixture renders apply form", async ({ page }) => {
    await page.goto(
      "/dev/ats-form?fixture=generic-apply.html&vp_app=00000000-0000-4000-8000-000000000001"
    )
    await expect(page.getByLabel("Primeiro nome")).toBeVisible()
    await expect(page.getByLabel("Senha da conta")).toBeVisible()
  })
})
