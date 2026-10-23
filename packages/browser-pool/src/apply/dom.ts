import type { Locator, Page } from "playwright-core"

import { normalizeLabel, partitionFields } from "./resolver.js"
import type {
  FieldInfo,
  FillContext,
  ResolvedAnswer,
  StepResult,
  UnknownQuestion,
} from "./types.js"

/**
 * Collects visible form controls inside `scope` and tags each with data-vp-key so later fills
 * target the same element. Runs in the page, so it must stay self-contained.
 */
export async function collectFields(
  page: Page,
  scope: string
): Promise<FieldInfo[]> {
  return page.evaluate((scopeSelector) => {
    const root = document.querySelector(scopeSelector) ?? document.body
    const out: FieldInfo[] = []
    let counter = Number(document.body.dataset.vpCounter ?? "0")
    const visible = (el: Element) => {
      const html = el as HTMLElement
      if (html instanceof HTMLInputElement && html.type === "file") return true
      const rect = html.getBoundingClientRect()
      const style = getComputedStyle(html)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      )
    }
    const labelFor = (el: HTMLElement): string => {
      const aria = el.getAttribute("aria-label")
      if (aria) return aria.trim()
      const labelledBy = el.getAttribute("aria-labelledby")
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim()
        if (text) return text
      }
      if (el.id) {
        const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (label?.textContent?.trim()) return label.textContent.trim()
      }
      const wrapping = el.closest("label")
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim()
      const fieldset = el.closest("fieldset")
      const legend = fieldset?.querySelector("legend")
      if (legend?.textContent?.trim()) return legend.textContent.trim()
      const placeholder = el.getAttribute("placeholder")
      return (placeholder ?? el.getAttribute("name") ?? "").trim()
    }
    // Terms link next to a checkbox (inside its label or the label's container).
    const linkFor = (el: HTMLElement): string | null => {
      const label =
        (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest("label")
      const scopes = [label, label?.parentElement, el.parentElement].filter(
        Boolean
      ) as Element[]
      for (const scopeEl of scopes) {
        const a = scopeEl.querySelector("a[href]") as HTMLAnchorElement | null
        if (a?.href && /^https?:/i.test(a.href)) return a.href
      }
      return null
    }
    const radios = new Map<string, FieldInfo>()
    const controls = root.querySelectorAll("input, select, textarea")
    for (const node of Array.from(controls)) {
      const el = node as HTMLInputElement
      const type = (el.getAttribute("type") ?? el.tagName).toLowerCase()
      // Passwords are never collected: only account steps fill them, and they never reach summaries.
      if (
        [
          "hidden",
          "submit",
          "button",
          "reset",
          "image",
          "search",
          "password",
        ].includes(type)
      )
        continue
      if (el.disabled || !visible(el)) continue
      if (!el.dataset.vpKey) el.dataset.vpKey = `vp${++counter}`
      const required =
        el.required || el.getAttribute("aria-required") === "true"
      if (type === "radio") {
        const groupName = el.name || el.dataset.vpKey
        const group = radios.get(groupName)
        const optionLabel = labelFor(el)
        if (group) {
          group.options.push(optionLabel)
          if (el.checked) group.currentValue = optionLabel
          continue
        }
        const fieldset = el.closest("fieldset")
        const question =
          fieldset?.querySelector("legend")?.textContent?.trim() ??
          el
            .closest("[data-question], .form-group, [role=radiogroup]")
            ?.querySelector("label, span, p")
            ?.textContent?.trim() ??
          groupName
        const info: FieldInfo = {
          key: el.dataset.vpKey,
          kind: "radio",
          label: question,
          name: el.name || null,
          autocomplete: null,
          required,
          options: [optionLabel],
          currentValue: el.checked ? optionLabel : null,
        }
        radios.set(groupName, info)
        out.push(info)
        continue
      }
      const kind =
        el.tagName === "SELECT"
          ? "select"
          : el.tagName === "TEXTAREA"
            ? "textarea"
            : [
                  "text",
                  "email",
                  "tel",
                  "url",
                  "number",
                  "checkbox",
                  "file",
                ].includes(type)
              ? type
              : type === "input"
                ? "text"
                : "unknown"
      const options =
        el.tagName === "SELECT"
          ? Array.from((el as unknown as HTMLSelectElement).options)
              .filter((o) => o.value !== "")
              .map((o) => o.textContent?.trim() ?? o.value)
          : []
      const current =
        type === "checkbox"
          ? el.checked
            ? "sim"
            : null
          : type === "file"
            ? el.files?.length
              ? "file"
              : null
            : el.value || null
      out.push({
        key: el.dataset.vpKey,
        kind: kind as FieldInfo["kind"],
        label: labelFor(el).replace(/\s+/g, " "),
        name: el.getAttribute("name"),
        autocomplete: el.getAttribute("autocomplete"),
        required,
        options,
        currentValue: current,
        linkHref: type === "checkbox" ? linkFor(el) : null,
      })
    }
    document.body.dataset.vpCounter = String(counter)
    return out
  }, scope) as Promise<FieldInfo[]>
}

function byKey(page: Page, key: string): Locator {
  return page.locator(`[data-vp-key="${key}"]`)
}

export async function applyAnswer(
  page: Page,
  field: FieldInfo,
  answer: ResolvedAnswer
): Promise<void> {
  const locator = byKey(page, field.key)
  switch (field.kind) {
    case "select":
      await locator.selectOption({ label: answer.value })
      return
    case "checkbox": {
      const want = /^(sim|yes|true)$/.test(normalizeLabel(answer.value))
      if (want) await locator.check()
      else await locator.uncheck()
      return
    }
    case "radio": {
      const name = field.name
      const group = name
        ? page.locator(`input[type=radio][name="${name}"]`)
        : locator
      const count = await group.count()
      for (let i = 0; i < count; i++) {
        const radio = group.nth(i)
        const label = await radio.evaluate((el) => {
          const input = el as HTMLInputElement
          const byFor = input.id
            ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            : null
          return (
            byFor?.textContent ??
            input.closest("label")?.textContent ??
            input.value ??
            ""
          ).trim()
        })
        if (normalizeLabel(label) === normalizeLabel(answer.value)) {
          await radio.check({ force: true })
          return
        }
      }
      throw new Error(`option not found for ${field.label}`)
    }
    case "file":
      await locator.setInputFiles(answer.value)
      return
    default:
      if (field.currentValue === answer.value) return
      await locator.fill(answer.value)
  }
}

/** Fills every resolvable field in `scope`; returns what was filled and what is unknown. */
export async function fillScope(
  page: Page,
  scope: string,
  ctx: FillContext
): Promise<StepResult> {
  const fields = await collectFields(page, scope)
  const { answers, unknown } = partitionFields(fields, ctx)
  const filled: ResolvedAnswer[] = []
  for (const { field, answer } of answers) {
    await applyAnswer(page, field, answer)
    filled.push(
      answer.source === "cv" ? { ...answer, value: "CV anexado" } : answer
    )
  }
  return { filled, unknown }
}

export async function unknownInScope(
  page: Page,
  scope: string,
  ctx: FillContext
): Promise<UnknownQuestion[]> {
  return partitionFields(await collectFields(page, scope), ctx).unknown
}

export async function summarizeScope(
  page: Page,
  scope: string
): Promise<{ label: string; value: string }[]> {
  const fields = await collectFields(page, scope)
  return fields
    .filter((f) => f.currentValue)
    .map((f) => ({
      label: f.label || f.name || f.key,
      value: f.kind === "file" ? "arquivo anexado" : String(f.currentValue),
    }))
}

const CAPTCHA_SELECTOR =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #captcha'

export async function hasCaptcha(page: Page): Promise<boolean> {
  const count = await page.locator(CAPTCHA_SELECTOR).count()
  if (count === 0) return false
  // A solved/invisible reCAPTCHA badge does not block the user.
  return page
    .locator(CAPTCHA_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false)
}

export async function clickFirstVisible(
  page: Page,
  selectors: string[]
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    for (let i = 0; i < count; i++) {
      const candidate = locator.nth(i)
      if (
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEnabled().catch(() => false))
      ) {
        await candidate.click()
        return true
      }
    }
  }
  return false
}
