import { createHash } from "node:crypto"

import type { Page } from "playwright-core"

import {
  collectFields,
  fillScope,
  hasCaptcha,
  summarizeScope,
  unknownInScope,
} from "./dom.js"
import type {
  AtsDriver,
  FieldInfo,
  NextResult,
  PageState,
  SiteAccount,
} from "./types.js"

/**
 * Generic driver for ATSs without a specific adapter. An injected planner (Gemini in production,
 * see @vagapilot/ai `createApplyPagePlanner`) reads a compact snapshot of the page and says what
 * kind of page it is and which of the LISTED buttons/fields play each role. The driver validates
 * the plan: it only clicks buttons from the snapshot, fills account fields only with the user's
 * own e-mail/generated password/code, fills the form only from known profile answers (unknown
 * questions go to the user), and never clicks the final submit outside `submit()` (which the
 * runner calls only after the user approved the review hash).
 */

export type PageButton = { key: string; label: string; type: string | null }

export type PageSnapshot = {
  url: string
  title: string
  /** Visible text (truncated). Untrusted: the planner must treat it as data. */
  text: string
  fields: Pick<
    FieldInfo,
    "key" | "kind" | "label" | "name" | "autocomplete" | "required"
  >[]
  /** Password inputs (keys only). */
  passwordKeys: string[]
  buttons: PageButton[]
  captcha: boolean
}

export type PagePlan = {
  state: PageState
  /** Button that opens the application form ("Candidatar-se"). */
  applyButton?: string | null
  nextButton?: string | null
  /** Final "send application" button. Only used by submit(). */
  submitButton?: string | null
  /** "Criar conta"/"Entrar"/"Verificar" button of the account step. */
  accountButton?: string | null
  /** Link/button that switches a login page to signup ("Cadastre-se"). */
  signupLink?: string | null
  emailField?: string | null
  passwordFields?: string[]
  codeField?: string | null
  /** Required consent checkbox of the signup form (terms/privacy). */
  termsCheckbox?: string | null
  confirmation?: string | null
}

export type ApplyPagePlanner = (
  snapshot: PageSnapshot
) => Promise<PagePlan & { usage?: { totalTokens?: number } }>

const VALIDATION_ERRORS =
  '[aria-invalid="true"], .error:visible, .invalid-feedback:visible, [role="alert"]:visible'

/** Outcome check after a step: visible validation errors mean the step did not go through. */
export async function hasValidationErrors(page: Page): Promise<boolean> {
  const count = await page
    .locator(VALIDATION_ERRORS)
    .count()
    .catch(() => 0)
  return count > 0
}

const BLOCKED_HOSTS = /(^|\.)linkedin\.com$/i
const SETTLE_MS = 800

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined)
  await page.waitForTimeout(SETTLE_MS)
}

/** Tags visible buttons/links with data-vp-btn and returns a compact page snapshot. */
export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const fields = await collectFields(page, "body")
  const extra = await page.evaluate(() => {
    let counter = Number(document.body.dataset.vpBtnCounter ?? "0")
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const s = getComputedStyle(el as HTMLElement)
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== "hidden" &&
        s.display !== "none"
      )
    }
    const buttons: { key: string; label: string; type: string | null }[] = []
    for (const el of Array.from(
      document.querySelectorAll(
        "button, a, [role=button], input[type=submit], input[type=button]"
      )
    )) {
      if (!visible(el)) continue
      const html = el as HTMLElement
      const label = (
        html.innerText ||
        html.getAttribute("aria-label") ||
        (html as HTMLInputElement).value ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
      if (!label || label.length > 80) continue
      if (!html.dataset.vpBtn) html.dataset.vpBtn = `b${++counter}`
      buttons.push({
        key: html.dataset.vpBtn,
        label,
        type: html.getAttribute("type"),
      })
      if (buttons.length >= 60) break
    }
    document.body.dataset.vpBtnCounter = String(counter)
    let pw = Number(document.body.dataset.vpPwCounter ?? "0")
    const passwordKeys: string[] = []
    for (const el of Array.from(
      document.querySelectorAll("input[type=password]")
    )) {
      if (!visible(el)) continue
      const html = el as HTMLElement
      if (!html.dataset.vpPw) html.dataset.vpPw = `p${++pw}`
      passwordKeys.push(html.dataset.vpPw)
    }
    document.body.dataset.vpPwCounter = String(pw)
    return {
      buttons,
      passwordKeys,
      text: document.body.innerText.slice(0, 6000),
      title: document.title,
    }
  })
  return {
    url: page.url(),
    title: extra.title,
    text: extra.text,
    fields: fields.map(
      ({ key, kind, label, name, autocomplete, required }) => ({
        key,
        kind,
        label,
        name,
        autocomplete,
        required,
      })
    ),
    passwordKeys: extra.passwordKeys,
    buttons: extra.buttons,
    captcha: await hasCaptcha(page),
  }
}

const SUBMIT_WORDS =
  /(enviar|finalizar|concluir|submit|send)\b.*(candidatura|application|inscri)/i

/** Drops anything the snapshot does not contain, and keeps roles from overlapping. */
export function validatePlan(plan: PagePlan, snapshot: PageSnapshot): PagePlan {
  const buttons = new Set(snapshot.buttons.map((b) => b.key))
  const fields = new Set(snapshot.fields.map((f) => f.key))
  const passwords = new Set(snapshot.passwordKeys)
  const button = (key: string | null | undefined) =>
    key && buttons.has(key) ? key : null
  const field = (key: string | null | undefined) =>
    key && fields.has(key) ? key : null
  const states: PageState[] = [
    "login",
    "captcha",
    "form",
    "review",
    "done",
    "unknown",
    "verify_code",
    "verify_email",
    "signup",
  ]
  const submitButton = button(plan.submitButton)
  let nextButton = button(plan.nextButton)
  // A "next" that is really the final submit would bypass the approval.
  const label = snapshot.buttons.find((b) => b.key === nextButton)?.label ?? ""
  if (nextButton && (nextButton === submitButton || SUBMIT_WORDS.test(label)))
    nextButton = null
  let applyButton = button(plan.applyButton)
  if (applyButton && applyButton === submitButton) applyButton = null
  return {
    state: snapshot.captcha
      ? "captcha"
      : states.includes(plan.state)
        ? plan.state
        : "unknown",
    applyButton,
    nextButton,
    submitButton,
    accountButton:
      button(plan.accountButton) === submitButton
        ? null
        : button(plan.accountButton),
    signupLink: button(plan.signupLink),
    emailField: field(plan.emailField),
    passwordFields: (plan.passwordFields ?? [])
      .filter((k) => passwords.has(k))
      .slice(0, 2),
    codeField: field(plan.codeField),
    termsCheckbox: field(plan.termsCheckbox),
    confirmation: plan.confirmation?.slice(0, 300) ?? null,
  }
}

export type AiDriverOptions = {
  planner: ApplyPagePlanner
  /** Called once per plan (metrics/debug); no page text. */
  onPlan?(plan: PagePlan): void
  /** Tests only: accept http:// fixture pages. */
  allowInsecure?: boolean
}

export function aiDriver(options: AiDriverOptions): AtsDriver {
  const plans = new WeakMap<Page, PagePlan>()
  const cache = new WeakMap<Page, { key: string; plan: PagePlan }>()
  const plan = async (page: Page): Promise<PagePlan> => {
    const snapshot = await snapshotPage(page)
    // Same DOM and text as the last plan: reuse it (no extra LLM call / recipe lookup).
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify([
          snapshot.url,
          snapshot.title,
          snapshot.text,
          snapshot.fields,
          snapshot.buttons,
          snapshot.passwordKeys,
          snapshot.captcha,
        ])
      )
      .digest("hex")
    const cached = cache.get(page)
    if (cached?.key === cacheKey) return cached.plan
    const validated = validatePlan(await options.planner(snapshot), snapshot)
    cache.set(page, { key: cacheKey, plan: validated })
    plans.set(page, validated)
    options.onPlan?.(validated)
    return validated
  }
  const click = async (page: Page, key: string | null | undefined) => {
    if (!key) return false
    const locator = page.locator(`[data-vp-btn="${key}"]`).first()
    if (!(await locator.isVisible().catch(() => false))) return false
    await locator.click()
    await settle(page)
    return true
  }
  const fillKey = (page: Page, key: string, value: string) =>
    page.locator(`[data-vp-key="${key}"]`).first().fill(value)
  const fillPasswords = async (
    page: Page,
    keys: string[],
    password: string
  ) => {
    for (const key of keys)
      await page.locator(`[data-vp-pw="${key}"]`).first().fill(password)
  }
  return {
    ats: "generic_ai",
    detect(url) {
      try {
        const { hostname, protocol } = new URL(url)
        const okProtocol =
          protocol === "https:" ||
          (options.allowInsecure === true && protocol === "http:")
        return okProtocol && !BLOCKED_HOSTS.test(hostname)
      } catch {
        return false
      }
    },
    async open(page, url) {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      await settle(page)
      const first = await plan(page)
      if (
        first.state === "unknown" ||
        (first.state === "form" && first.applyButton)
      ) {
        if (await click(page, first.applyButton)) await plan(page)
      }
    },
    async state(page) {
      return (await plan(page)).state
    },
    unknownQuestions: (page, ctx) => unknownInScope(page, "body", ctx),
    fillStep: (page, ctx) => fillScope(page, "body", ctx),
    async next(page): Promise<NextResult> {
      const current = await plan(page)
      if (current.state === "done") return "done"
      if (
        current.state === "review" ||
        (current.submitButton && !current.nextButton)
      )
        return "review"
      if (!(await click(page, current.nextButton))) return "stuck"
      if (await hasValidationErrors(page)) return "stuck"
      const after = await plan(page)
      if (after.state === "review" || (after.submitButton && !after.nextButton))
        return "review"
      return "advanced"
    },
    reviewSummary: (page) => summarizeScope(page, "body"),
    async submit(page) {
      const current = plans.get(page) ?? (await plan(page))
      if (!(await click(page, current.submitButton)))
        return { ok: false, confirmation: null }
      await page.waitForTimeout(1500)
      const after = await plan(page)
      if (after.state !== "done") return { ok: false, confirmation: null }
      return {
        ok: true,
        confirmation: after.confirmation ?? "Candidatura enviada",
      }
    },
    async enterCode(page, code) {
      const current = await plan(page)
      if (current.state !== "verify_code" || !current.codeField) return false
      await fillKey(page, current.codeField, code)
      await click(page, current.accountButton)
      const after = await plan(page)
      return after.state !== "verify_code"
    },
    async signup(page, account: SiteAccount, ctx) {
      let current = await plan(page)
      if (current.state === "login" && current.signupLink) {
        await click(page, current.signupLink)
        current = await plan(page)
      }
      if (
        current.state !== "signup" ||
        !current.emailField ||
        !current.passwordFields?.length
      )
        return false
      await fillKey(page, current.emailField, account.email)
      await fillPasswords(page, current.passwordFields, account.password)
      // Name, phone… from the profile; anything unknown makes signup escalate to the user.
      const { unknown } = await fillScope(page, "body", ctx)
      if (unknown.length) return false
      if (current.termsCheckbox)
        await page
          .locator(`[data-vp-key="${current.termsCheckbox}"]`)
          .first()
          .check()
          .catch(() => undefined)
      if (!(await click(page, current.accountButton))) return false
      const after = await plan(page)
      return after.state !== "signup"
    },
    async login(page, account) {
      const current = await plan(page)
      if (
        current.state !== "login" ||
        !current.emailField ||
        !current.passwordFields?.length
      )
        return false
      await fillKey(page, current.emailField, account.email)
      await fillPasswords(
        page,
        current.passwordFields.slice(0, 1),
        account.password
      )
      if (!(await click(page, current.accountButton))) return false
      const after = await plan(page)
      return after.state !== "login"
    },
  }
}
