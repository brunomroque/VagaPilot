import type { Page } from "playwright-core"

import { clickFirstVisible, fillScope, hasCaptcha, summarizeScope, unknownInScope } from "./dom.js"
import type { AtsDriver, NextResult, PageState } from "./types.js"

type DriverSpec = {
  ats: string
  hosts: RegExp
  /** Container of the form (modal for LinkedIn). */
  scope: string
  openButtons: string[]
  nextButtons: string[]
  submitButtons: string[]
  doneText: RegExp
  isLogin(page: Page): Promise<boolean>
}

const SETTLE_MS = 600

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined)
  await page.waitForTimeout(SETTLE_MS)
}

async function anyVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    for (let i = 0; i < count; i++) {
      if (await locator.nth(i).isVisible().catch(() => false)) return true
    }
  }
  return false
}

export function textDriver(spec: DriverSpec): AtsDriver {
  return {
    ats: spec.ats,
    detect: (url) => {
      try {
        return spec.hosts.test(new URL(url).hostname)
      } catch {
        return false
      }
    },
    async open(page, url) {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      await settle(page)
      if (await anyVisible(page, [spec.scope])) {
        const fields = await page.locator(`${spec.scope} input, ${spec.scope} select, ${spec.scope} textarea`).count()
        if (fields > 0) return
      }
      if (await clickFirstVisible(page, spec.openButtons)) await settle(page)
    },
    async state(page): Promise<PageState> {
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000)
      if (spec.doneText.test(body)) return "done"
      if (await hasCaptcha(page)) return "captcha"
      if (await spec.isLogin(page)) return "login"
      if (await anyVisible(page, spec.submitButtons)) return "review"
      if (await anyVisible(page, [`${spec.scope} input`, `${spec.scope} select`, `${spec.scope} textarea`])) return "form"
      return "unknown"
    },
    unknownQuestions: (page, ctx) => unknownInScope(page, spec.scope, ctx),
    fillStep: (page, ctx) => fillScope(page, spec.scope, ctx),
    async next(page): Promise<NextResult> {
      const body = await page.locator("body").innerText().catch(() => "")
      if (spec.doneText.test(body)) return "done"
      if (await anyVisible(page, spec.submitButtons)) return "review"
      if (!(await clickFirstVisible(page, spec.nextButtons))) return "stuck"
      await settle(page)
      if (await anyVisible(page, spec.submitButtons)) return "review"
      return "advanced"
    },
    reviewSummary: (page) => summarizeScope(page, spec.scope),
    async submit(page) {
      if (!(await clickFirstVisible(page, spec.submitButtons))) return { ok: false, confirmation: null }
      await settle(page)
      await page.waitForTimeout(1500)
      const body = await page.locator("body").innerText().catch(() => "")
      const match = body.match(spec.doneText)
      if (!match) return { ok: false, confirmation: null }
      const protocol = body.match(/(protocolo|c[oó]digo|n[uú]mero)[^\n]{0,80}/i)?.[0] ?? null
      return { ok: true, confirmation: (protocol ?? match[0]).slice(0, 300) }
    },
  }
}

const btn = (...texts: string[]) => texts.map((t) => `button:has-text("${t}"), a[role=button]:has-text("${t}")`)

export const gupyDriver = textDriver({
  ats: "gupy",
  hosts: /(^|\.)gupy\.io$/i,
  scope: "form, main",
  openButtons: [
    '[data-testid="apply-button"]',
    ...btn("Candidatar-se", "Candidatar", "Quero me candidatar", "Aplicar"),
  ],
  nextButtons: [
    '[data-testid="next-step-button"]',
    ...btn("Salvar e continuar", "Continuar", "Próximo", "Próxima etapa", "Avançar"),
  ],
  submitButtons: [
    '[data-testid="submit-application"]',
    ...btn("Enviar candidatura", "Finalizar candidatura", "Concluir candidatura"),
  ],
  doneText: /candidatura (enviada|realizada|conclu[ií]da)( com sucesso)?|parab[eé]ns,? sua candidatura/i,
  async isLogin(page) {
    if (/\/(login|signin|sign-in|cadastro)\b/i.test(new URL(page.url()).pathname)) return true
    return (await page.locator('input[type="password"]').count()) > 0
  },
})

export const linkedinEasyApplyDriver = textDriver({
  ats: "linkedin",
  hosts: /(^|\.)linkedin\.com$/i,
  scope: '.jobs-easy-apply-modal, [data-test-modal][role="dialog"], [role="dialog"]',
  openButtons: [
    "button.jobs-apply-button",
    'button[aria-label*="Easy Apply"]',
    'button[aria-label*="Candidatura simplificada"]',
    ...btn("Easy Apply", "Candidatura simplificada"),
  ],
  nextButtons: [
    'button[aria-label="Continue to next step"]',
    'button[aria-label="Avançar para próxima etapa"]',
    'button[aria-label="Review your application"]',
    'button[aria-label="Revise sua candidatura"]',
    ...btn("Next", "Avançar", "Review", "Revisar"),
  ],
  submitButtons: [
    'button[aria-label="Submit application"]',
    'button[aria-label="Enviar candidatura"]',
    ...btn("Submit application", "Enviar candidatura"),
  ],
  doneText: /your application was sent|candidatura (foi )?enviada|application submitted/i,
  async isLogin(page) {
    return /\/(login|checkpoint|authwall|uas\/login)/i.test(new URL(page.url()).pathname)
  },
})

export const ATS_DRIVERS: AtsDriver[] = [gupyDriver, linkedinEasyApplyDriver]

/**
 * LinkedIn automation is against its User Agreement and can get the account restricted, so the
 * Easy Apply driver is off unless APPLY_LINKEDIN_ENABLED=true.
 */
export function enabledDrivers(env: Record<string, string | undefined> = process.env): AtsDriver[] {
  return env.APPLY_LINKEDIN_ENABLED === "true" ? ATS_DRIVERS : [gupyDriver]
}

export function driverForUrl(url: string, drivers: AtsDriver[] = enabledDrivers()): AtsDriver | null {
  return drivers.find((driver) => driver.detect(url)) ?? null
}
