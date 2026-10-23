import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"
import type { Page } from "playwright-core"

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "unknown"

/** A form control as seen in the page (serialisable; `key` is a stable data-vp-key). */
export type FieldInfo = {
  key: string
  kind: FieldKind
  label: string
  name: string | null
  autocomplete: string | null
  required: boolean
  options: string[]
  currentValue: string | null
}

export type ResolvedAnswer = {
  label: string
  value: string
  source: "profile" | "standard_answer" | "run_answer" | "cv"
}

export type UnknownQuestion = {
  label: string
  kind: FieldKind
  options: string[]
  required: boolean
}

export type PageState =
  | "login"
  | "captcha"
  | "form"
  | "review"
  | "done"
  | "unknown"
  /** The site asks for a code sent by e-mail (or SMS). */
  | "verify_code"
  /** The site asks to click a link sent by e-mail. */
  | "verify_email"
  /** The site requires creating an account before applying. */
  | "signup"

/** Site account used for signup/login (password only in memory, stored sealed). */
export type SiteAccount = { email: string; password: string; created: boolean }

export type StepResult = {
  filled: ResolvedAnswer[]
  unknown: UnknownQuestion[]
}

export type NextResult = "advanced" | "review" | "done" | "stuck"

export type FillContext = {
  payload: ApplicationPackagePayload
  /** Answers given by the user for THIS run, keyed by normalised question label. */
  runAnswers: Record<string, string>
  cvPath: string | null
}

/** One ATS (spec 11.1). Nothing here ever clicks the final submit except `submit`. */
export interface AtsDriver {
  readonly ats: string
  detect(url: string): boolean
  /** Opens the posting and gets to the first form step (clicks "Candidatar"/"Easy Apply"). */
  open(page: Page, url: string): Promise<void>
  state(page: Page): Promise<PageState>
  /** Fields of the current step that the profile/answers cannot fill. */
  unknownQuestions(page: Page, ctx: FillContext): Promise<UnknownQuestion[]>
  fillStep(page: Page, ctx: FillContext): Promise<StepResult>
  /** Advances one step. Must NOT submit: returns "review" when only submit is left. */
  next(page: Page): Promise<NextResult>
  reviewSummary(page: Page): Promise<{ label: string; value: string }[]>
  submit(page: Page): Promise<{ ok: boolean; confirmation: string | null }>
  /** Types a verification code into the current step and confirms it. */
  enterCode?(page: Page, code: string): Promise<boolean>
  /** Creates the account on the signup form (never the application submit). */
  signup?(page: Page, account: SiteAccount, ctx: FillContext): Promise<boolean>
  /** Logs in with a stored site account. */
  login?(page: Page, account: SiteAccount): Promise<boolean>
}
