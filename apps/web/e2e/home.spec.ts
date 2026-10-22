import { expect, test } from "@playwright/test"

test("public home shows the product pitch and auth links", async ({ page }) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Seu copiloto de candidaturas.",
    })
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
    "href",
    "/cadastro"
  )
  await expect(page.getByRole("link", { name: "Entrar" })).toHaveAttribute(
    "href",
    "/entrar"
  )
})

test("unauthenticated visits to /app are redirected to /entrar", async ({
  page,
}) => {
  await page.goto("/app/candidaturas")
  await expect(page).toHaveURL(/\/entrar\?next=%2Fapp%2Fcandidaturas/)
  await expect(
    page.getByRole("heading", { name: "Entrar no VagaPilot" })
  ).toBeVisible()
})
