import type { CachedResponse, FetchCtx } from "./types.js"

type Env = Readonly<Record<string, string | undefined>>

/**
 * Third-party fetch/scraping services tried when a job site blocks the direct read
 * (429/999, authwall, empty page). Each one is opt-in by env var; without its key it is skipped.
 * Only the public job URL is sent; never user cookies or credentials (CA4.3).
 */
export type FetchProvider = {
  name: string
  /** Returns the page HTML (or text) or null when the provider could not read it. */
  fetch(
    url: string,
    ctx: Pick<FetchCtx, "fetch">,
    signal: AbortSignal
  ): Promise<string | null>
}

async function bodyIfOk(response: Response): Promise<string | null> {
  if (!response.ok) return null
  const body = await response.text()
  return body.trim() ? body : null
}

export function jinaProvider(apiKey?: string): FetchProvider {
  return {
    name: "jina",
    async fetch(url, ctx, signal) {
      const headers: Record<string, string> = { "X-Return-Format": "html" }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      return bodyIfOk(
        await ctx.fetch(`https://r.jina.ai/${url}`, { headers, signal })
      )
    },
  }
}

export function browserlessProvider(
  token: string,
  endpoint = "https://production-sfo.browserless.io"
): FetchProvider {
  return {
    name: "browserless",
    async fetch(url, ctx, signal) {
      return bodyIfOk(
        await ctx.fetch(
          `${endpoint}/content?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              gotoOptions: { waitUntil: "domcontentloaded" },
            }),
            signal,
          }
        )
      )
    },
  }
}

export function firecrawlProvider(apiKey: string): FetchProvider {
  return {
    name: "firecrawl",
    async fetch(url, ctx, signal) {
      const response = await ctx.fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats: ["rawHtml"] }),
        signal,
      })
      if (!response.ok) return null
      const json = (await response.json().catch(() => null)) as {
        data?: { rawHtml?: string; html?: string }
      } | null
      return json?.data?.rawHtml || json?.data?.html || null
    },
  }
}

function queryProvider(
  name: string,
  base: string,
  keyParam: string,
  key: string
): FetchProvider {
  return {
    name,
    async fetch(url, ctx, signal) {
      const target = new URL(base)
      target.searchParams.set(keyParam, key)
      target.searchParams.set("url", url)
      return bodyIfOk(await ctx.fetch(target.toString(), { signal }))
    },
  }
}

export const scrapingBeeProvider = (key: string) =>
  queryProvider(
    "scrapingbee",
    "https://app.scrapingbee.com/api/v1/",
    "api_key",
    key
  )
export const zenRowsProvider = (key: string) =>
  queryProvider("zenrows", "https://api.zenrows.com/v1/", "apikey", key)
export const scraperApiProvider = (key: string) =>
  queryProvider("scraperapi", "https://api.scraperapi.com/", "api_key", key)

export const DEFAULT_PROVIDER_ORDER = [
  "browserless",
  "firecrawl",
  "zenrows",
  "scrapingbee",
  "scraperapi",
  "jina",
] as const

/**
 * Providers in `JOB_FETCH_PROVIDERS` order (comma list) or the default order.
 * Keyed providers without a key are skipped. Jina works keyless unless `JOB_FETCH_JINA=off`.
 */
export function providersFromEnv(env: Env): FetchProvider[] {
  const order = (env.JOB_FETCH_PROVIDERS ?? DEFAULT_PROVIDER_ORDER.join(","))
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const out: FetchProvider[] = []
  for (const name of order) {
    if (name === "browserless" && env.BROWSERLESS_API_TOKEN)
      out.push(
        browserlessProvider(
          env.BROWSERLESS_API_TOKEN,
          env.BROWSERLESS_REST_URL || undefined
        )
      )
    else if (name === "firecrawl" && env.FIRECRAWL_API_KEY)
      out.push(firecrawlProvider(env.FIRECRAWL_API_KEY))
    else if (name === "zenrows" && env.ZENROWS_API_KEY)
      out.push(zenRowsProvider(env.ZENROWS_API_KEY))
    else if (name === "scrapingbee" && env.SCRAPINGBEE_API_KEY)
      out.push(scrapingBeeProvider(env.SCRAPINGBEE_API_KEY))
    else if (name === "scraperapi" && env.SCRAPERAPI_API_KEY)
      out.push(scraperApiProvider(env.SCRAPERAPI_API_KEY))
    else if (name === "jina" && env.JOB_FETCH_JINA !== "off")
      out.push(jinaProvider(env.JINA_API_KEY || undefined))
  }
  return out
}

export const PROVIDER_TIMEOUT_MS = 12_000

/**
 * Tries each provider in order until one returns a body that `accept` approves, staying
 * inside `budgetMs` overall. Logs which provider succeeded (never the key or the body).
 */
export async function fetchViaProviders(
  ctx: FetchCtx,
  url: string,
  accept: (body: string) => boolean = () => true
): Promise<{ provider: string; response: CachedResponse } | null> {
  const providers = ctx.providers ?? []
  if (providers.length === 0) return null
  const deadline = Date.now() + (ctx.providerBudgetMs ?? 28_000)
  for (const provider of providers) {
    const left = deadline - Date.now()
    if (left < 2_000) break
    const signal = AbortSignal.timeout(Math.min(PROVIDER_TIMEOUT_MS, left))
    try {
      const body = await provider.fetch(url, ctx, signal)
      if (body && accept(body)) {
        console.info("job fetch provider ok", { provider: provider.name, url })
        const response: CachedResponse = {
          status: 200,
          body,
          contentType: "text/html",
        }
        await ctx.cache?.set(url, response, 24 * 60 * 60 * 1000)
        return { provider: provider.name, response }
      }
      console.warn("job fetch provider unusable", {
        provider: provider.name,
        url,
      })
    } catch (error) {
      console.warn("job fetch provider failed", {
        provider: provider.name,
        url,
        reason: error instanceof Error ? error.name : "unknown",
      })
    }
  }
  return null
}
