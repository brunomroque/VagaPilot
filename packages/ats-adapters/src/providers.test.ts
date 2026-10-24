import { describe, expect, it } from "vitest"

import { extractJob } from "./detect.js"
import {
  fetchViaProviders,
  providersFromEnv,
  type FetchProvider,
} from "./providers.js"
import type { FetchCtx } from "./types.js"

const JOB_HTML = `<html><head><title>Dev</title></head><body>
<h1 class="top-card-layout__title">Desenvolvedora Backend</h1>
<a class="topcard__org-name-link">Acme</a>
<div class="show-more-less-html__markup">Node e SQL</div></body></html>`

const blocked: typeof fetch = async () => new Response("", { status: 429 })

function fake(
  name: string,
  body: string | null,
  calls: string[]
): FetchProvider {
  return {
    name,
    async fetch() {
      calls.push(name)
      return body
    },
  }
}

describe("providersFromEnv", () => {
  it("skips providers without keys and keeps the configured order", () => {
    expect(providersFromEnv({}).map((p) => p.name)).toEqual(["jina"])
    expect(
      providersFromEnv({
        BROWSERLESS_API_TOKEN: "x",
        ZENROWS_API_KEY: "y",
        JOB_FETCH_PROVIDERS: "zenrows,browserless,firecrawl",
      }).map((p) => p.name)
    ).toEqual(["zenrows", "browserless"])
    expect(providersFromEnv({ JOB_FETCH_JINA: "off" })).toEqual([])
  })
})

describe("fetchViaProviders", () => {
  it("returns the first provider whose body is accepted", async () => {
    const calls: string[] = []
    const ctx: FetchCtx = {
      fetch: blocked,
      providers: [
        fake("a", null, calls),
        fake("b", "authwall", calls),
        fake("c", "ok", calls),
      ],
    }
    const result = await fetchViaProviders(ctx, "https://x", (b) => b === "ok")
    expect(result?.provider).toBe("c")
    expect(calls).toEqual(["a", "b", "c"])
  })

  it("stops when the budget is spent", async () => {
    const ctx: FetchCtx = {
      fetch: blocked,
      providers: [fake("a", "ok", [])],
      providerBudgetMs: 1_000,
    }
    expect(await fetchViaProviders(ctx, "https://x")).toBeNull()
  })
})

describe("LinkedIn fallback chain", () => {
  it("uses a provider when guest and public page are rate limited", async () => {
    const calls: string[] = []
    const result = await extractJob(
      "https://www.linkedin.com/jobs/view/4482789372/",
      {
        fetch: blocked,
        providers: [
          fake("p1", "<html><title>Sign in | authwall</title></html>", calls),
          fake("p2", JOB_HTML, calls),
        ],
      }
    )
    expect(calls).toEqual(["p1", "p2"])
    expect(result).toMatchObject({
      status: "ok",
      posting: { title: "Desenvolvedora Backend", company: "Acme" },
    })
  })

  it("keeps the blocked result when no provider can read it", async () => {
    const result = await extractJob(
      "https://www.linkedin.com/jobs/view/4482789372/",
      {
        fetch: blocked,
        providers: [],
      }
    )
    expect(result).toEqual({ status: "blocked", reason: "rate_limited" })
  })
})
