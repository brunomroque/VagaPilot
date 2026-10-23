import { createHash } from "node:crypto"

import type { Page } from "playwright-core"

import type { AtsDriver, FillContext, PageState, ResolvedAnswer, UnknownQuestion } from "./types.js"

export type ReviewField = { label: string; value: string }

export type SegmentOutcome =
  | { kind: "needs_answers"; questions: UnknownQuestion[] }
  | { kind: "waiting_user"; reason: "login" | "captcha" }
  | { kind: "review"; summary: ReviewField[]; summaryHash: string; screenshot: Buffer }
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
  onWaitingUser?(reason: "login" | "captcha"): Promise<void>
  /** How long to wait for the human before pausing the run. */
  humanWaitMs?: number
  now?: () => number
  maxSteps?: number
  onProgress?(step: number, filled: ResolvedAnswer[]): Promise<void>
}

export function hashSummary(summary: ReviewField[]): string {
  return createHash("sha256").update(JSON.stringify(summary)).digest("hex")
}

async function waitForHuman(input: SegmentInput, reason: "login" | "captcha"): Promise<PageState | "timeout"> {
  const now = input.now ?? Date.now
  await input.onWaitingUser?.(reason)
  const until = Math.min(now() + (input.humanWaitMs ?? 8 * 60_000), input.deadline)
  while (now() < until) {
    await input.page.waitForTimeout(3000)
    const state = await input.driver.state(input.page)
    if (state !== reason) return state
  }
  return "timeout"
}

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
    for (let step = 0; step < maxSteps; step++) {
      if (now() >= input.deadline) return { kind: "continue" }
      let state = await driver.state(page)
      if (state === "login" || state === "captcha") {
        const after = await waitForHuman(input, state)
        if (after === "timeout") return { kind: "waiting_user", reason: state }
        // After login the ATS often lands elsewhere: reopen the posting.
        if (state === "login") await driver.open(page, input.url)
        state = await driver.state(page)
      }
      if (state === "done") {
        return { kind: "failed", code: "already_applied", message: "O ATS indica que esta candidatura já foi enviada." }
      }
      const { filled, unknown } = await driver.fillStep(page, ctx)
      await input.onProgress?.(step, filled)
      if (unknown.length > 0) return { kind: "needs_answers", questions: unknown }
      const moved = await driver.next(page)
      if (moved === "stuck") {
        const left = await driver.unknownQuestions(page, ctx)
        if (left.length > 0) return { kind: "needs_answers", questions: left }
        return { kind: "failed", code: "stuck", message: "Não encontrei o botão para avançar." }
      }
      if (moved === "done") {
        return { kind: "failed", code: "already_applied", message: "O ATS indica que esta candidatura já foi enviada." }
      }
      if (moved !== "review") continue
      // Review step: also fill anything shown there before summarising.
      const last = await driver.fillStep(page, ctx)
      if (last.unknown.length > 0) return { kind: "needs_answers", questions: last.unknown }
      const summary = await driver.reviewSummary(page)
      const summaryHash = hashSummary(summary)
      if (!input.approvedSummaryHash) {
        const screenshot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })
        return { kind: "review", summary, summaryHash, screenshot }
      }
      if (input.approvedSummaryHash !== summaryHash) {
        const screenshot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })
        // Something changed since approval: ask again instead of submitting.
        return { kind: "review", summary, summaryHash, screenshot }
      }
      const result = await driver.submit(page)
      const screenshot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })
      if (!result.ok) return { kind: "failed", code: "submit_unconfirmed", message: "Cliquei em enviar mas não vi a confirmação do ATS." }
      return { kind: "submitted", confirmation: result.confirmation, screenshot }
    }
    return { kind: "failed", code: "too_many_steps", message: "Formulário com etapas demais." }
  } catch (error) {
    return {
      kind: "failed",
      code: "runner_error",
      message: error instanceof Error ? error.message.slice(0, 300) : "Erro inesperado.",
    }
  }
}
