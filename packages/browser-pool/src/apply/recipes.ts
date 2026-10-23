import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ApplyPagePlanner, PagePlan, PageSnapshot } from "./ai-driver.js"
import { normalizeLabel } from "./resolver.js"
import type { PageState } from "./types.js"

/**
 * Learned ATS recipes (table `ats_recipes`). When the generic AI driver works on an unknown ATS,
 * each page it handled becomes a step: expected-state assertions, a structural fingerprint and the
 * role of each button/field described by role/label/text/name (never by the per-page data-vp key,
 * never with values). Next runs replay the steps WITHOUT LLM calls; drift decides when to ask the
 * AI again:
 *   low    → replay; a role that cannot be resolved is healed by the AI for that step only
 *   medium → the AI re-verifies that step and the recipe is updated
 *   high / required fields changed → recipe "stale": replay stops, AI relearns, new version saved
 * The review (submit) step is replayed only from a trusted, non-stale recipe with low drift;
 * otherwise the AI verifies it. The final submit still requires the user's approval.
 *
 * Shared recipes hold page structure only. Answers to screening questions stay per user
 * (standard answers / run answers), and no secret or typed value ever enters a recipe.
 */

export type Descriptor = {
  role: "button" | "link" | "field"
  text: string
  name?: string | null
  autocomplete?: string | null
  kind?: string | null
}

export type StepAssertions = {
  urlPattern: string
  heading: string
  keyTexts: string[]
  requiredFields: { label: string; kind: string }[]
  cta: Descriptor | null
}

export type RecipeStep = {
  state: PageState
  assertions: StepAssertions
  fingerprint: string
  roles: {
    applyButton?: Descriptor | null
    nextButton?: Descriptor | null
    submitButton?: Descriptor | null
    accountButton?: Descriptor | null
    signupLink?: Descriptor | null
    emailField?: Descriptor | null
    codeField?: Descriptor | null
    termsCheckbox?: Descriptor | null
    passwordFields?: number
  }
  /** Field labels seen on this step (no values), for documentation and drift. */
  fieldLabels: string[]
}

export type RecipeStatus =
  "learning" | "trusted" | "stale" | "relearning" | "disabled"

export type AtsRecipe = {
  id?: string
  domain: string
  platform: string
  version: number
  status: RecipeStatus
  steps: RecipeStep[]
  successes: number
  failures: number
  last_validated_at?: string | null
  drift_history?: DriftEntry[]
}

export type DriftEntry = {
  at: string
  step: number
  score: number
  level: DriftLevel
}
export type DriftLevel = "low" | "medium" | "high"

export const RECIPE_TRUST_AFTER = 3
export const DRIFT_MEDIUM = 0.2
export const DRIFT_HIGH = 0.5

// ---------------------------------------------------------------- snapshot → step

/** Removes anything that may be personal or secret (digits runs, e-mails, long text). */
export function safeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[^\s@]+@[^\s@]+/g, "")
    .replace(/\d{4,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

export function urlPattern(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    const path = pathname
      .split("/")
      .map((seg) => (/\d/.test(seg) || seg.length > 24 ? "*" : seg))
      .join("/")
    return `${hostname}${path}`
  } catch {
    return ""
  }
}

function requiredSet(snapshot: PageSnapshot) {
  return snapshot.fields
    .filter((f) => f.required)
    .map((f) => ({
      label: normalizeLabel(safeText(f.label || f.name || "")),
      kind: f.kind,
    }))
    .sort((a, b) => (a.label + a.kind).localeCompare(b.label + b.kind))
}

/** Hash of the normalized field set + password count (structure only). */
export function formFingerprint(snapshot: PageSnapshot): string {
  const fields = snapshot.fields
    .map(
      (f) => `${f.kind}:${normalizeLabel(safeText(f.label || f.name || ""))}`
    )
    .sort()
  return createHash("sha256")
    .update(`${fields.join("|")}#pw${snapshot.passwordKeys.length}`)
    .digest("hex")
    .slice(0, 16)
}

function describeButton(
  snapshot: PageSnapshot,
  key: string | null | undefined
): Descriptor | null {
  const b = snapshot.buttons.find((x) => x.key === key)
  return b
    ? { role: b.type === "link" ? "link" : "button", text: safeText(b.label) }
    : null
}

function describeField(
  snapshot: PageSnapshot,
  key: string | null | undefined
): Descriptor | null {
  const f = snapshot.fields.find((x) => x.key === key)
  return f
    ? {
        role: "field",
        text: safeText(f.label),
        name: f.name,
        autocomplete: f.autocomplete,
        kind: f.kind,
      }
    : null
}

function heading(snapshot: PageSnapshot): string {
  return normalizeLabel(safeText(snapshot.title))
}

function keyTexts(snapshot: PageSnapshot): string[] {
  return snapshot.text
    .split("\n")
    .map((l) => safeText(l))
    .filter((l) => l.length >= 4 && l.length <= 60)
    .slice(0, 3)
    .map(normalizeLabel)
}

export function stepFromPlan(
  snapshot: PageSnapshot,
  plan: PagePlan
): RecipeStep {
  const cta =
    describeButton(snapshot, plan.submitButton) ??
    describeButton(snapshot, plan.nextButton) ??
    describeButton(snapshot, plan.accountButton) ??
    describeButton(snapshot, plan.applyButton)
  return {
    state: plan.state,
    assertions: {
      urlPattern: urlPattern(snapshot.url),
      heading: heading(snapshot),
      keyTexts: keyTexts(snapshot),
      requiredFields: requiredSet(snapshot),
      cta,
    },
    fingerprint: formFingerprint(snapshot),
    roles: {
      applyButton: describeButton(snapshot, plan.applyButton),
      nextButton: describeButton(snapshot, plan.nextButton),
      submitButton: describeButton(snapshot, plan.submitButton),
      accountButton: describeButton(snapshot, plan.accountButton),
      signupLink: describeButton(snapshot, plan.signupLink),
      emailField: describeField(snapshot, plan.emailField),
      codeField: describeField(snapshot, plan.codeField),
      termsCheckbox: describeField(snapshot, plan.termsCheckbox),
      passwordFields: plan.passwordFields?.length ?? 0,
    },
    fieldLabels: snapshot.fields
      .map((f) => safeText(f.label || f.name || ""))
      .filter(Boolean)
      .slice(0, 40),
  }
}

// ---------------------------------------------------------------- resolving descriptors

/** Fallbacks: exact text → contains → name → autocomplete. Returns the snapshot key or null. */
export function resolveDescriptor(
  snapshot: PageSnapshot,
  d: Descriptor | null | undefined
): string | null {
  if (!d) return null
  const want = normalizeLabel(d.text)
  if (d.role === "field") {
    const fields = snapshot.fields.filter((f) => !d.kind || f.kind === d.kind)
    const label = (f: (typeof fields)[number]) =>
      normalizeLabel(safeText(f.label))
    return (
      (want && fields.find((f) => label(f) === want)?.key) ||
      (want &&
        fields.find(
          (f) =>
            label(f).includes(want) || (label(f) && want.includes(label(f)))
        )?.key) ||
      (d.name && fields.find((f) => f.name === d.name)?.key) ||
      (d.autocomplete &&
        fields.find((f) => f.autocomplete === d.autocomplete)?.key) ||
      null
    )
  }
  const label = (b: PageSnapshot["buttons"][number]) =>
    normalizeLabel(safeText(b.label))
  return (
    (want && snapshot.buttons.find((b) => label(b) === want)?.key) ||
    (want && snapshot.buttons.find((b) => label(b).includes(want))?.key) ||
    null
  )
}

export type ResolvedStep = { plan: PagePlan; missing: string[] }

export function planFromStep(
  snapshot: PageSnapshot,
  step: RecipeStep
): ResolvedStep {
  const missing: string[] = []
  const r = <K extends keyof RecipeStep["roles"]>(role: K) => {
    const d = step.roles[role] as Descriptor | null | undefined
    if (!d) return null
    const key = resolveDescriptor(snapshot, d)
    if (!key) missing.push(role)
    return key
  }
  const want = step.roles.passwordFields ?? 0
  if (snapshot.passwordKeys.length < want) missing.push("passwordFields")
  return {
    plan: {
      state: snapshot.captcha ? "captcha" : step.state,
      applyButton: r("applyButton"),
      nextButton: r("nextButton"),
      submitButton: r("submitButton"),
      accountButton: r("accountButton"),
      signupLink: r("signupLink"),
      emailField: r("emailField"),
      codeField: r("codeField"),
      termsCheckbox: r("termsCheckbox"),
      passwordFields: snapshot.passwordKeys.slice(0, want),
      confirmation: null,
    },
    missing,
  }
}

// ---------------------------------------------------------------- drift

export type Drift = {
  score: number
  level: DriftLevel
  requiredChanged: boolean
  reasons: string[]
}

/** 0 = identical page, 1 = unrelated page. */
export function driftScore(snapshot: PageSnapshot, step: RecipeStep): Drift {
  const reasons: string[] = []
  let score = 0
  const a = step.assertions
  if (urlPattern(snapshot.url) !== a.urlPattern) {
    score += 0.15
    reasons.push("url")
  }
  if (a.heading && heading(snapshot) !== a.heading) {
    score += 0.1
    reasons.push("heading")
  }
  const texts = normalizeLabel(snapshot.text)
  const missingTexts = a.keyTexts.filter((t) => !texts.includes(t)).length
  if (a.keyTexts.length && missingTexts) {
    score += 0.1 * (missingTexts / a.keyTexts.length)
    reasons.push("key_text")
  }
  const now = requiredSet(snapshot).map((f) => `${f.kind}:${f.label}`)
  const before = a.requiredFields.map((f) => `${f.kind}:${f.label}`)
  const union = new Set([...now, ...before])
  const same = now.filter((x) => before.includes(x)).length
  const requiredChanged = union.size > 0 && same !== union.size
  if (requiredChanged) {
    score += 0.4 * (1 - same / union.size)
    reasons.push("required_fields")
  }
  if (a.cta && !resolveDescriptor(snapshot, a.cta)) {
    score += 0.25
    reasons.push("cta")
  }
  if (formFingerprint(snapshot) !== step.fingerprint) {
    score += 0.05
    reasons.push("fingerprint")
  }
  score = Math.min(1, Math.round(score * 1000) / 1000)
  const level: DriftLevel =
    requiredChanged || score >= DRIFT_HIGH
      ? "high"
      : score >= DRIFT_MEDIUM
        ? "medium"
        : "low"
  return { score, level, requiredChanged, reasons }
}

// ---------------------------------------------------------------- replaying planner

export type RecipeStats = {
  llmCalls: number
  llmTokens: number
  replayedSteps: number
  healedSteps: number
  drift: DriftEntry[]
  stale: boolean
  changed: boolean
}

export type PlannerResult = PagePlan & { usage?: { totalTokens?: number } }

export type RecipeSession = {
  planner: ApplyPagePlanner
  stats: RecipeStats
  /** Steps to save (learned/healed); null when nothing changed. */
  learnedSteps(): RecipeStep[] | null
}

/**
 * Wraps the LLM planner with a recipe. With no recipe every page is learned; with one, pages
 * that match a step with low drift are answered without the LLM.
 */
export function recipeSession(
  recipe: AtsRecipe | null,
  llm: (snapshot: PageSnapshot) => Promise<PlannerResult>,
  now: () => Date = () => new Date()
): RecipeSession {
  const steps: RecipeStep[] = recipe ? recipe.steps.map((s) => ({ ...s })) : []
  const usable = Boolean(
    recipe && recipe.status !== "disabled" && recipe.status !== "stale"
  )
  const trusted = recipe?.status === "trusted"
  const stats: RecipeStats = {
    llmCalls: 0,
    llmTokens: 0,
    replayedSteps: 0,
    healedSteps: 0,
    drift: [],
    stale: false,
    changed: !recipe,
  }
  const ask = async (snapshot: PageSnapshot) => {
    stats.llmCalls += 1
    const result = await llm(snapshot)
    stats.llmTokens += result.usage?.totalTokens ?? 0
    return result
  }
  const learn = (
    snapshot: PageSnapshot,
    plan: PagePlan,
    replace: number | null
  ) => {
    const step = stepFromPlan(snapshot, plan)
    if (replace !== null && replace >= 0) steps[replace] = step
    else if (
      !steps.some(
        (s) => s.fingerprint === step.fingerprint && s.state === step.state
      )
    )
      steps.push(step)
    stats.changed = true
  }
  const planner: ApplyPagePlanner = async (snapshot) => {
    if (!usable || stats.stale) {
      const plan = await ask(snapshot)
      learn(snapshot, plan, null)
      return plan
    }
    // Closest step by drift.
    let best = -1
    let drift: Drift | null = null
    steps.forEach((step, i) => {
      const d = driftScore(snapshot, step)
      if (!drift || d.score < drift.score) {
        drift = d
        best = i
      }
    })
    const d = drift as Drift | null
    if (!d || best < 0) {
      const plan = await ask(snapshot)
      learn(snapshot, plan, null)
      return plan
    }
    stats.drift.push({
      at: now().toISOString(),
      step: best,
      score: d.score,
      level: d.level,
    })
    if (d.level === "high") {
      // Page changed under the recipe: stop replaying, relearn everything with the AI.
      stats.stale = true
      const plan = await ask(snapshot)
      learn(snapshot, plan, null)
      return plan
    }
    const step = steps[best]!
    const resolved = planFromStep(snapshot, step)
    const isSubmitStep =
      step.state === "review" || Boolean(step.roles.submitButton)
    if (
      d.level === "medium" ||
      resolved.missing.length ||
      (isSubmitStep && !trusted)
    ) {
      // Self-heal / re-verify this step only.
      const plan = await ask(snapshot)
      learn(snapshot, plan, best)
      stats.healedSteps += 1
      return plan
    }
    stats.replayedSteps += 1
    return resolved.plan
  }
  return {
    planner,
    stats,
    learnedSteps: () =>
      stats.changed || stats.stale ? steps.filter(Boolean) : null,
  }
}

// ---------------------------------------------------------------- persistence

export const RECIPE_COLUMNS =
  "id, domain, platform, version, status, steps, successes, failures, last_validated_at, drift_history"

/** Latest version for the domain (disabled ones are returned so the caller can skip replay). */
export async function loadRecipe(
  admin: SupabaseClient,
  domain: string
): Promise<AtsRecipe | null> {
  const { data } = await admin
    .from("ats_recipes")
    .select(RECIPE_COLUMNS)
    .eq("domain", domain)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as AtsRecipe | null) ?? null
}

export type RecipeRunResult = "success" | "failure" | "neutral"

/**
 * Saves the outcome of one run: counters, drift history, promotion to trusted, and a NEW version
 * when steps were learned/healed or the recipe went stale (older versions stay for rollback).
 */
export async function saveRecipeRun(
  admin: SupabaseClient,
  input: {
    domain: string
    platform: string
    recipe: AtsRecipe | null
    session: RecipeSession
    result: RecipeRunResult
    trustAfter?: number
  }
): Promise<void> {
  const { recipe, session, result } = input
  if (recipe?.status === "disabled") return
  const nowIso = new Date().toISOString()
  const history = [
    ...(recipe?.drift_history ?? []),
    ...session.stats.drift,
  ].slice(-50)
  const learned = session.learnedSteps()
  const success = result === "success" ? 1 : 0
  const failure = result === "failure" ? 1 : 0
  try {
    if (learned && learned.length) {
      // Stale recipe: mark the old version, keep it, save the relearned one.
      if (recipe?.id && session.stats.stale)
        await admin
          .from("ats_recipes")
          .update({
            status: "stale",
            drift_history: history,
            updated_at: nowIso,
          })
          .eq("id", recipe.id)
      await admin.from("ats_recipes").insert({
        domain: input.domain,
        platform: input.platform,
        version: (recipe?.version ?? 0) + 1,
        status:
          result === "success"
            ? "learning"
            : session.stats.stale
              ? "relearning"
              : "learning",
        steps: learned,
        successes: success,
        failures: failure,
        last_validated_at: result === "success" ? nowIso : null,
        drift_history: history,
        parent_version: recipe?.version ?? null,
      })
      return
    }
    if (!recipe?.id) return
    const successes = recipe.successes + success
    const status: RecipeStatus =
      recipe.status === "learning" &&
      successes >= (input.trustAfter ?? RECIPE_TRUST_AFTER)
        ? "trusted"
        : recipe.status
    await admin
      .from("ats_recipes")
      .update({
        successes,
        failures: recipe.failures + failure,
        status,
        drift_history: history,
        ...(result === "success" ? { last_validated_at: nowIso } : {}),
        updated_at: nowIso,
      })
      .eq("id", recipe.id)
  } catch {
    // Metrics only: never break the run.
  }
}
