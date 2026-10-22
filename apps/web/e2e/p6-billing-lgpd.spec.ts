import { expect, test } from "@playwright/test"

import { signInAsDevUser } from "./support"

/**
 * P6 smoke (fictitious Marina): planos page and LGPD export endpoint auth gate.
 * Full Stripe/Gmail send flows need env keys; covered by Vitest in packages/core.
 */
test.describe("P6 billing and LGPD shell", () => {
  test("CA6.3 planos page lists free tier without Gmail", async ({ page }) => {
    await signInAsDevUser(page, "/app")
    await page.goto("/app/planos")
    await expect(page.getByRole("heading", { name: /Planos/i })).toBeVisible()
    await expect(page.getByText("Sem Gmail")).toBeVisible()
  })

  test("privacy export requires session", async ({ request }) => {
    const res = await request.post("/api/privacy/export")
    expect(res.status()).toBe(401)
  })
})
