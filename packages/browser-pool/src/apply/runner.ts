import { createHash } from "node:crypto"

import type { Page } from "playwright-core"

import type {
  AtsDriver,
  FillContext,
  PageState,
  ResolvedAnswer,
  SiteAccount,
  UnknownQuestion,
} from "./types.js"

export type WaitReason = "login" | "captcha" | "verification"

/** A verification read from the user's mailbox. `value` is never persisted or logged. */
export type VerificationFound = {
  value: string
  messageId: string
  via: string
}

export type VerificationEvent =
  | { kind: "code_used"; messageId: string; via: string; length: number }
  | { kind: "link_opened"; messageId: string; host: string }
  | { kind: "escalated"; step: "code" | "link" | "signup"; reason: string }
  | { kind: "signed_up"; created: boolean }
  | { kind: "logged_in" }

export type SegmentVerification = {
  /** Fresh code e-mail from the run's ATS sent after `since` (or null after the timeout). */
  awaitCode(since: Date): Promise<VerificationFound | null>
  /** Fresh, allowlisted and resolved confirmation link (or null). */
  awaitLink(since: Date): Promise<VerificationFound | null>
}

export type ReviewField = { label: string; value: string }

export type SegmentOutcome =
  | { kind: "needs_answers"; questions: UnknownQuestion[] }
  | { kind: "waiting_user"; reason: WaitReason }
  | {
      kind: "review"
      summary: ReviewField[]
      summaryHash: string
      screenshot: Buffer
    }
  | { kind: "submitted"; confirmation: string | null; screenshot: Buffer }
  | { kind: "continue" }
  | { kind: "failed"; code: string; message: string }

export type SegmentInput = {
  page: Page
  driver: AtsDriver
  url: string
  ctx: FillContext
  /** epoch ms: stop and return "continue" before this (provider/function time limit). */
  deadline: number
  /** Set only after the user approved this exact summary hash. */
  approvedSummaryHash?: string | null
  /** Called when login/captcha blocks; the run waits for the human in the live view. */
  onWaitingUser?(reason: WaitReason): Promise<void>
  /** Gmail-backed verification for this run (absent: the user types the code in live view). */
  verification?: SegmentVerification | null
  /** Site account: `get` an existing one, `create` (generate + seal) one for signup. */
  account?: {
    get(): Promise<SiteAccount | null>
    create(): Promise<SiteAccount>
  } | null
  /**
   * Standing permission for account/e-mail actions. "ask" pauses with a permission question,
   * "deny" hands the step to the human in the live view. Absent: allowed (legacy behaviour).
   */
  permit?(
    action: "create_site_account" | "open_email_link" | "use_email_code"
  ): Promise<"allow" | "ask" | "deny">
  /** Audit hook (no secrets: codes and passwords never reach it). */
  onVerification?(event: VerificationEvent): Promise<void>
  /** Called after signup/verification so the job saves browser_auth_states right away. */
  onAuthenticated?(): Promise<void>
  /** How long to wait for the human before pausing the run. */
  humanWaitMs?: number
  now?: () => number
  maxSteps?: number
  onProgress?(step: number, filled: ResolvedAnswer[]): Promise<void>
}

/** JSON with sorted keys, so a hash survives a jsonb round trip (Postgres reorders keys). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function hashPreview(preview: unknown): string {
  return createHash("sha256").update(stableStringify(preview)).digest("hex")
}

export function hashSummary(summary: ReviewField[]): string {
  return hashPreview(summary)
}

async function waitForHuman(
  input: SegmentInput,
  reason: WaitReason,
  blocking: PageState
): Promise<PageState | "timeout"> {
  const now = input.now ?? Date.now
  await input.onWaitingUser?.(reason)
  const until = Math.min(
    now() + (input.humanWaitMs ?? 8 * 60_000),
    input.deadline
  )
  while (now() < until) {
    await input.page.waitForTimeout(3000)
    const state = await input.driver.state(input.page)
    if (state !== blocking) return state
  }
  return "timeout"
}

const PERMISSION_TITLES = {
  create_site_account: "Criar conta no site",
  open_email_link: "Abrir link de confirmação do e-mail",
  use_email_code: "Usar código recebido por e-mail",
} as const

/** null: go ahead; "deny": hand over to the human; outcome: pause and ask. */
async function gateAction(
  input: SegmentInput,
  action: keyof typeof PERMISSION_TITLES
): Promise<null | "deny" | SegmentOutcome> {
  if (!input.permit) return null
  const decision = await input.permit(action)
  if (decision === "allow") return null
  if (decision === "deny") return "deny"
  return {
    kind: "needs_answers",
    questions: [
      {
        label: `Permissão do agente: ${PERMISSION_TITLES[action]}`,
        kind: "radio",
        options: ["Permitir", "Negar"],
        required: true,
        permission: { action },
      },
    ],
  }
}

const MAX_AUTO_VERIFICATIONS = 3

/**
 * Account and e-mail verification steps. Returns the new state, or an outcome when the run must
 * pause. Codes and links come only from the run's ATS domain (see @vagapilot/gmail verification);
 * anything we cannot do (SMS, no Gmail, nothing arrived) goes to the human in the live view.
 */
async function handleAccountStep(
  input: SegmentInput,
  state: PageState,
  attempts: { n: number }
): Promise<PageState | SegmentOutcome> {
  const now = input.now ?? Date.now
  const { page, driver } = input
  const escalate = async (step: "code" | "link" | "signup", why: string) => {
    await input.onVerification?.({ kind: "escalated", step, reason: why })
    const after = await waitForHuman(
      input,
      step === "signup" ? "login" : "verification",
      state
    )
    if (after === "timeout")
      return {
        kind: "waiting_user",
        reason: step === "signup" ? "login" : "verification",
      } as SegmentOutcome
    return after
  }
  if (attempts.n >= MAX_AUTO_VERIFICATIONS)
    return escalate(
      state === "signup"
        ? "signup"
        : state === "verify_email"
          ? "link"
          : "code",
      "too_many_attempts"
    )
  attempts.n += 1
  if (state === "login" || state === "signup") {
    const existing = await input.account?.get().catch(() => null)
    if (state === "login" && existing && driver.login) {
      if (await driver.login(page, existing)) {
        await input.onVerification?.({ kind: "logged_in" })
        await input.onAuthenticated?.()
        await driver.open(page, input.url)
        return driver.state(page)
      }
    }
    if (state === "signup" && driver.signup && input.account) {
      if (!existing) {
        const gate = await gateAction(input, "create_site_account")
        if (gate === "deny") return escalate("signup", "permission_denied")
        if (gate) return gate
      }
      const account = existing ?? (await input.account.create())
      const result = await driver.signup(page, account, input.ctx)
      // Consent boxes of the signup form (terms/privacy) are never ticked by us: ask the user.
      if (typeof result === "object" && result.questions.length)
        return { kind: "needs_answers", questions: result.questions }
      if (result === true) {
        await input.onVerification?.({
          kind: "signed_up",
          created: account.created,
        })
        return driver.state(page)
      }
      return escalate("signup", "signup_failed")
    }
    return state === "login" ? "login" : escalate("signup", "no_signup_support")
  }
  const since = new Date(now() - 30_000)
  if (state === "verify_code") {
    if (!input.verification || !driver.enterCode)
      return escalate("code", "no_gmail")
    const gate = await gateAction(input, "use_email_code")
    if (gate === "deny") return escalate("code", "permission_denied")
    if (gate) return gate
    const found = await input.verification.awaitCode(since)
    if (!found) return escalate("code", "no_code_email")
    if (!(await driver.enterCode(page, found.value)))
      return escalate("code", "code_rejected")
    await input.onVerification?.({
      kind: "code_used",
      messageId: found.messageId,
      via: found.via,
      length: found.value.length,
    })
    await input.onAuthenticated?.()
    return driver.state(page)
  }
  // verify_email
  if (!input.verification) return escalate("link", "no_gmail")
  const gate = await gateAction(input, "open_email_link")
  if (gate === "deny") return escalate("link", "permission_denied")
  if (gate) return gate
  const found = await input.verification.awaitLink(since)
  if (!found) return escalate("link", "no_link_email")
  // Same browser context, so the session the ATS creates sticks to this run.
  await page.goto(found.value, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)
  await input.onVerification?.({
    kind: "link_opened",
    messageId: found.messageId,
    host: new URL(found.value).hostname,
  })
  await input.onAuthenticated?.()
  await driver.open(page, input.url)
  return driver.state(page)
}

const ACCOUNT_STATES = new Set<PageState>([
  "login",
  "signup",
  "verify_code",
  "verify_email",
])

/**
 * One resumable segment: open the posting, replay known answers step by step, stop at unknown
 * questions, human checkpoints (login/captcha), the review screen, or the deadline.
 * The final submit happens only when `approvedSummaryHash` matches the current review.
 */
export async function runSegment(input: SegmentInput): Promise<SegmentOutcome> {
  const now = input.now ?? Date.now
  const { page, driver, ctx } = input
  const maxSteps = input.maxSteps ?? 15
  try {
    await driver.open(page, input.url)
    const attempts = { n: 0 }
    for (let step = 0; step < maxSteps; step++) {
      if (now() >= input.deadline) return { kind: "continue" }
      let state = await driver.state(page)
      for (let hop = 0; hop < 4 && ACCOUNT_STATES.has(state); hop++) {
        if (state === "login" && !(input.account && driver.login)) break
        const next = await handleAccountStep(input, state, attempts)
        if (typeof next === "object") return next
        if (next === state && state === "login") break
        state = next
      }
      if (state === "login" || state === "captcha") {
        const after = await waitForHuman(input, state, state)
        if (after === "timeout") return { kind: "waiting_user", reason: state }
        // After login the ATS often lands elsewhere: reopen the posting.
        if (state === "login") await driver.open(page, input.url)
        state = await driver.state(page)
      }
      if (ACCOUNT_STATES.has(state) && state !== "login") continue
      if (state === "done") {
        return {
          kind: "failed",
          code: "already_applied",
          message: "O ATS indica que esta candidatura já foi enviada.",
        }
      }
      const { filled, unknown } = await driver.fillStep(page, ctx)
      await input.onProgress?.(step, filled)
      if (unknown.length > 0)
        return { kind: "needs_answers", questions: unknown }
      const moved = await driver.next(page)
      if (moved === "stuck") {
        const left = await driver.unknownQuestions(page, ctx)
        if (left.length > 0) return { kind: "needs_answers", questions: left }
        return {
          kind: "failed",
          code: "stuck",
          message: "Não encontrei o botão para avançar.",
        }
      }
      if (moved === "done") {
        return {
          kind: "failed",
          code: "already_applied",
          message: "O ATS indica que esta candidatura já foi enviada.",
        }
      }
      if (moved !== "review") continue
      // Review step: also fill anything shown there before summarising.
      const last = await driver.fillStep(page, ctx)
      if (last.unknown.length > 0)
        return { kind: "needs_answers", questions: last.unknown }
      const summary = await driver.reviewSummary(page)
      const summaryHash = hashSummary(summary)
      if (!input.approvedSummaryHash) {
        const screenshot = await page.screenshot({
          type: "jpeg",
          quality: 55,
          fullPage: true,
        })
        return { kind: "review", summary, summaryHash, screenshot }
      }
      if (input.approvedSummaryHash !== summaryHash) {
        const screenshot = await page.screenshot({
          type: "jpeg",
          quality: 55,
          fullPage: true,
        })
        // Something changed since approval: ask again instead of submitting.
        return { kind: "review", summary, summaryHash, screenshot }
      }
      const result = await driver.submit(page)
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: 55,
        fullPage: true,
      })
      if (!result.ok)
        return {
          kind: "failed",
          code: "submit_unconfirmed",
          message: "Cliquei em enviar mas não vi a confirmação do ATS.",
        }
      return {
        kind: "submitted",
        confirmation: result.confirmation,
        screenshot,
      }
    }
    return {
      kind: "failed",
      code: "too_many_steps",
      message: "Formulário com etapas demais.",
    }
  } catch (error) {
    return {
      kind: "failed",
      code: "runner_error",
      message:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Erro inesperado.",
    }
  }
}
