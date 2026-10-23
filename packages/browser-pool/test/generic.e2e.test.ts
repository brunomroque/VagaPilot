import { existsSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"

import { chromium, type Browser } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  aiDriver,
  type PagePlan,
  type PageSnapshot,
} from "../src/apply/ai-driver.js"
import {
  recipeSession,
  type AtsRecipe,
  type RecipeSession,
} from "../src/apply/recipes.js"
import { runSegment, type SegmentVerification } from "../src/apply/runner.js"
import { samplePayload } from "./payload.js"

/**
 * Generic AI driver end to end against a fixture ATS (apply → e-mail code → form → review →
 * submit), with a fake planner standing in for Gemini and a fake Gmail verification. Then the
 * learned recipe is replayed without LLM calls, self-heals a renamed button, and goes stale when
 * the required fields change. Skips when no Chromium is installed.
 */
const executablePath = (() => {
  try {
    const path = chromium.executablePath()
    return existsSync(path) ? path : null
  } catch {
    return null
  }
})()

const button = (s: PageSnapshot, re: RegExp) =>
  s.buttons.find((b) => re.test(b.label))?.key ?? null

/** Rule-based stand-in for the Gemini planner; counts calls and fake tokens. */
function fakePlanner() {
  const counter = { calls: 0 }
  const planner = async (
    s: PageSnapshot
  ): Promise<PagePlan & { usage: { totalTokens: number } }> => {
    counter.calls += 1
    const usage = { totalTokens: 1000 }
    if (/Candidatura enviada/.test(s.text))
      return { state: "done", confirmation: "Protocolo GEN-2026-7", usage }
    const submit = button(s, /enviar candidatura/i)
    if (submit) return { state: "review", submitButton: submit, usage }
    const code = s.fields.find((f) => /código/i.test(f.label))
    if (code)
      return {
        state: "verify_code",
        codeField: code.key,
        accountButton: button(s, /confirmar/i),
        usage,
      }
    const next = button(s, /continuar|prosseguir|avançar/i)
    if (next) return { state: "form", nextButton: next, usage }
    return { state: "unknown", applyButton: button(s, /candidatar/i), usage }
  }
  return { planner, counter }
}

const verification: SegmentVerification = {
  awaitCode: async () => ({ value: "482913", messageId: "m-1", via: "regex" }),
  awaitLink: async () => null,
}

describe.skipIf(!executablePath)(
  "generic AI driver + recipes (fixture ATS)",
  () => {
    let server: Server
    let base = ""
    let browser: Browser

    beforeAll(async () => {
      server = createServer((req, res) => {
        const name = (req.url ?? "/").split("?")[0]!.replace(/^\//, "")
        const file = join(import.meta.dirname, "fixtures", `${name}.html`)
        if (!existsSync(file)) return void res.writeHead(404).end()
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(readFileSync(file))
      })
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      )
      const address = server.address()
      base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
      browser = await chromium.launch()
    }, 60_000)

    afterAll(async () => {
      await browser?.close().catch(() => undefined)
      server?.close()
    })

    const ctx = { payload: samplePayload(), runAnswers: {}, cvPath: null }

    async function run(
      session: RecipeSession,
      variant: string,
      approve = true
    ) {
      const driver = aiDriver({ planner: session.planner, allowInsecure: true })
      const url = `${base}/generic?v=${variant}`
      const page = await (await browser.newContext()).newPage()
      const events: string[] = []
      const first = await runSegment({
        page,
        driver,
        url,
        ctx,
        verification,
        deadline: Date.now() + 60_000,
        onVerification: async (e) => void events.push(e.kind),
      })
      if (first.kind !== "review" || !approve) return { first, events, page }
      const page2 = await (await browser.newContext()).newPage()
      const second = await runSegment({
        page: page2,
        driver,
        url,
        ctx,
        verification,
        deadline: Date.now() + 60_000,
        approvedSummaryHash: first.summaryHash,
      })
      return { first, second, events, page: page2 }
    }

    let learned: AtsRecipe | null = null

    it("learns an unknown ATS end to end: code from e-mail, review, submit only after approval", async () => {
      const { planner, counter } = fakePlanner()
      const session = recipeSession(null, planner)
      const { first, second, events, page } = await run(session, "a")
      expect(first.kind).toBe("review")
      expect(events).toContain("code_used")
      expect(second?.kind).toBe("submitted")
      expect(
        await page.evaluate(
          () => (window as unknown as { submitted: number }).submitted
        )
      ).toBe(1)
      expect(counter.calls).toBeGreaterThan(0)
      expect(session.stats.llmTokens).toBe(counter.calls * 1000)
      const steps = session.learnedSteps()
      expect(steps?.map((s) => s.state)).toEqual(
        expect.arrayContaining(["verify_code", "form", "review", "done"])
      )
      // Shared recipe: structure only, never the code, the user's e-mail or name.
      const json = JSON.stringify(steps)
      expect(json).not.toMatch(/482913|bruno@example\.com|Bruno Teste/)
      learned = {
        domain: "127.0.0.1",
        platform: "generic_ai",
        version: 1,
        status: "trusted",
        steps: steps!,
        successes: 3,
        failures: 0,
      }
    }, 120_000)

    it("replays a trusted recipe with zero LLM calls", async () => {
      const { planner, counter } = fakePlanner()
      const session = recipeSession(learned, planner)
      const { first, second } = await run(session, "a")
      expect(first.kind).toBe("review")
      expect(second?.kind).toBe("submitted")
      expect(counter.calls).toBe(0)
      expect(session.stats.replayedSteps).toBeGreaterThan(0)
      expect(session.learnedSteps()).toBeNull()
      expect(session.stats.drift.every((d) => d.level === "low")).toBe(true)
    }, 120_000)

    it("a learning (not trusted) recipe still asks the AI to verify the submit step", async () => {
      const { planner, counter } = fakePlanner()
      const session = recipeSession(
        { ...learned!, status: "learning" },
        planner
      )
      const { first } = await run(session, "a", false)
      expect(first.kind).toBe("review")
      expect(counter.calls).toBe(1)
    }, 120_000)

    it("self-heals only the step whose button changed", async () => {
      const { planner, counter } = fakePlanner()
      const session = recipeSession(learned, planner)
      const { first } = await run(session, "b", false)
      expect(first.kind).toBe("review")
      expect(counter.calls).toBe(1)
      expect(session.stats.healedSteps).toBe(1)
      expect(session.stats.stale).toBe(false)
      expect(JSON.stringify(session.learnedSteps())).toMatch(/Prosseguir/)
    }, 120_000)

    it("goes stale when the required fields change and stops replaying", async () => {
      const { planner, counter } = fakePlanner()
      const session = recipeSession(learned, planner)
      const { first } = await run(session, "c", false)
      expect(session.stats.stale).toBe(true)
      expect(session.stats.drift.some((d) => d.level === "high")).toBe(true)
      expect(counter.calls).toBeGreaterThan(0)
      // Unknown personal fields go back to the user, nothing is submitted.
      expect(first.kind).toBe("needs_answers")
    }, 120_000)
  }
)
