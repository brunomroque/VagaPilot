import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"

import { chromium, type Browser } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { gupyDriver, linkedinEasyApplyDriver } from "../src/apply/drivers.js"
import { normalizeLabel } from "../src/apply/resolver.js"
import { runSegment } from "../src/apply/runner.js"
import {
  acquireBrowser,
  MemoryConcurrencyStore,
  type BrowserProviderAdapter,
  type ProviderConfig,
} from "../src/index.js"
import { samplePayload } from "./payload.js"

/**
 * Real Chromium against local fixture pages. The "cloud provider" is a mock adapter that hands out
 * the CDP endpoint of a locally launched Chromium, so the same connectOverCDP path is exercised.
 * Skips when no Chromium is installed (`pnpm exec playwright install chromium`).
 */
const executablePath = (() => {
  try {
    const path = chromium.executablePath()
    return existsSync(path) ? path : null
  } catch {
    return null
  }
})()

const fixtures = join(import.meta.dirname, "fixtures")
const PORT_CDP = 9400 + Math.floor(Math.random() * 400)

describe.skipIf(!executablePath)("apply e2e (fixtures + mock provider)", () => {
  let server: Server
  let base = ""
  let local: Browser
  let browser: Browser
  let cvPath = ""

  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = (req.url ?? "/").split("?")[0]!.replace(/^\//, "")
      const file = join(fixtures, `${name}.html`)
      if (!existsSync(file)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(file))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
    local = await chromium.launch({ args: [`--remote-debugging-port=${PORT_CDP}`] })

    const config = { id: "mock", provider: "steel", label: "Mock", enabled: true, priority: 1, concurrencyLimit: 1, maxSessionSeconds: 900, quotaKind: "credits_monthly", quotaLimit: 5, costPerMinute: 0.001, quotaResetDay: 1, quotaStartedAt: "2026-10-01T00:00:00Z", keyExpiresAt: null, alertThreshold: 0.8 } as ProviderConfig
    const adapter: BrowserProviderAdapter = {
      type: "steel",
      createSession: async () => ({ externalId: "mock-1", cdpUrl: `http://127.0.0.1:${PORT_CDP}`, liveViewUrl: "https://live.example/mock-1" }),
      closeSession: async () => undefined,
    }
    const acquired = await acquireBrowser(
      { providers: [config], usedUnits: async () => 0, concurrency: new MemoryConcurrencyStore(), adapterFor: () => adapter },
      { timeoutSeconds: 120, headful: true }
    )
    browser = await chromium.connectOverCDP(acquired.session.cdpUrl)
    const dir = await mkdtemp(join(tmpdir(), "vp-e2e-"))
    cvPath = join(dir, "Bruno Teste - CV.pdf")
    await writeFile(cvPath, "%PDF-1.4 fixture")
  }, 60_000)

  afterAll(async () => {
    await browser?.close().catch(() => undefined)
    await local?.close().catch(() => undefined)
    server?.close()
  })

  const page = async () => {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    return context.newPage()
  }

  it("gupy: asks unknown question, then review, then submits only with the approved hash", async () => {
    const payload = samplePayload()
    const url = `${base}/gupy`
    const deadline = () => Date.now() + 60_000

    const p1 = await page()
    const first = await runSegment({ page: p1, driver: gupyDriver, url, ctx: { payload, runAnswers: {}, cvPath }, deadline: deadline() })
    expect(first.kind).toBe("needs_answers")
    const question = first.kind === "needs_answers" ? first.questions[0]! : null
    expect(question?.label).toMatch(/híbrido/)
    expect(question?.options).toEqual(["Sim", "Não"])

    const runAnswers = { [normalizeLabel(question!.label)]: "sim" }
    const p2 = await page()
    const second = await runSegment({ page: p2, driver: gupyDriver, url, ctx: { payload, runAnswers, cvPath }, deadline: deadline() })
    expect(second.kind).toBe("review")
    expect(await p2.evaluate(() => (window as unknown as { submitted: number }).submitted)).toBe(0)
    const hash = second.kind === "review" ? second.summaryHash : ""

    const p3 = await page()
    const tampered = await runSegment({ page: p3, driver: gupyDriver, url, ctx: { payload, runAnswers, cvPath }, deadline: deadline(), approvedSummaryHash: "other" })
    expect(tampered.kind).toBe("review")
    expect(await p3.evaluate(() => (window as unknown as { submitted: number }).submitted)).toBe(0)

    const p4 = await page()
    const third = await runSegment({ page: p4, driver: gupyDriver, url, ctx: { payload, runAnswers, cvPath }, deadline: deadline(), approvedSummaryHash: hash })
    expect(third.kind).toBe("submitted")
    expect(third.kind === "submitted" ? third.confirmation : "").toMatch(/Protocolo GPY-2026-0001/)
  }, 90_000)

  it("linkedin easy apply: radio question then review (no submit without approval)", async () => {
    const payload = samplePayload()
    const url = `${base}/linkedin`
    const first = await runSegment({ page: await page(), driver: linkedinEasyApplyDriver, url, ctx: { payload, runAnswers: {}, cvPath: null }, deadline: Date.now() + 60_000 })
    expect(first.kind).toBe("needs_answers")
    const label = first.kind === "needs_answers" ? first.questions[0]!.label : ""
    expect(label).toMatch(/authorized/)
    const second = await runSegment({ page: await page(), driver: linkedinEasyApplyDriver, url, ctx: { payload, runAnswers: { [normalizeLabel(label)]: "Yes" }, cvPath: null }, deadline: Date.now() + 60_000 })
    expect(second.kind).toBe("review")
  }, 90_000)

  it("stops at the deadline with continue", async () => {
    const result = await runSegment({ page: await page(), driver: gupyDriver, url: `${base}/gupy`, ctx: { payload: samplePayload(), runAnswers: {}, cvPath }, deadline: Date.now() - 1 })
    expect(result.kind).toBe("continue")
  })
})
